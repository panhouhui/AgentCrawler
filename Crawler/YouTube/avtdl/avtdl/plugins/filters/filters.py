import asyncio
import json
import re
from collections import OrderedDict
from pathlib import Path
from typing import List, Mapping, Optional, Sequence

from pydantic import Field, field_validator

from avtdl.core import utils
from avtdl.core.actors import ActorConfig, Filter, FilterEntity
from avtdl.core.interfaces import Event, Record, TextRecord
from avtdl.core.plugins import Plugins
from avtdl.core.runtime import RuntimeContext
from avtdl.core.utils import find_matching_field


@Plugins.register('filter.noop', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.void', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.match', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.exclude', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.event', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.event.cause', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.type', Plugins.kind.ACTOR_CONFIG)
@Plugins.register('filter.json', Plugins.kind.ACTOR_CONFIG)
class EmptyFilterConfig(ActorConfig):
    pass


@Plugins.register('filter.noop', Plugins.kind.ACTOR_ENTITY)
@Plugins.register('filter.void', Plugins.kind.ACTOR_ENTITY)
@Plugins.register('filter.event.cause', Plugins.kind.ACTOR_ENTITY)
class EmptyFilterEntity(FilterEntity):
    pass


@Plugins.register('filter.noop', Plugins.kind.ACTOR)
class NoopFilter(Filter):
    """
    Pass everything through

    Lets all incoming records pass through unchanged, effectively
    doing nothing with them. As any other filter it has entities,
    so it can be used as a merging point to gather records from
    multiple chains and process them in a single place.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[EmptyFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: FilterEntity, record: Record) -> Record:
        return record


@Plugins.register('filter.void', Plugins.kind.ACTOR)
class VoidFilter(Filter):
    """
    Drop everything

    Does not produce anything, dropping all incoming records.
    Can be used to stuff multiple chains in one if the need ever arises.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[EmptyFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: FilterEntity, record: Record) -> None:
        return None


@Plugins.register('filter.match', Plugins.kind.ACTOR_ENTITY)
@Plugins.register('filter.exclude', Plugins.kind.ACTOR_ENTITY)
class MatchFilterEntity(FilterEntity):
    patterns: List[str] = Field(default_factory=list)
    """list of strings to search for in the record"""
    patterns_file: Optional[Path] = None
    """optional text file with one keyword per line. Text before parentheses is kept as a keyword, text inside parentheses is split on "/" and added as separate keywords"""
    fields: Optional[List[str]] = None
    """field names to search the patterns in. If not specified, all fields are checked"""


def load_patterns_file(path: Optional[Path], logger) -> List[str]:
    if path is None:
        return []
    try:
        text = path.read_text(encoding='utf-8-sig')
    except OSError as e:
        logger.warning(f'failed to read patterns file "{path}": {e}')
        return []

    patterns: List[str] = []
    seen = set()

    def add_pattern(pattern: str) -> None:
        pattern = pattern.strip()
        if not pattern or pattern in seen:
            return
        seen.add(pattern)
        patterns.append(pattern)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.match(r'^(.*?)\s*(?:\((.*?)\))?\s*$', line)
        if match is None:
            add_pattern(line)
            continue
        add_pattern(match.group(1))
        aliases = match.group(2)
        if aliases:
            for alias in aliases.split('/'):
                add_pattern(alias)
    logger.info(f'loaded {len(patterns)} patterns from "{path}"')
    return patterns


@Plugins.register('filter.match', Plugins.kind.ACTOR)
class MatchFilter(Filter):
    """
    Keep records with specific words

    This filter lets through records that have one of the values
    defined by `patterns` list found in any (or specified) field of the record.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[MatchFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)
        self.patterns_by_entity = {
            entity.name: [*entity.patterns, *load_patterns_file(entity.patterns_file, self.logger)]
            for entity in entities
        }

    def match(self, entity: MatchFilterEntity, record: Record) -> Optional[Record]:
        for pattern in self.patterns_by_entity.get(entity.name, entity.patterns):
            field = find_matching_field(record, pattern, entity.fields)
            if field is not None:
                self.logger.debug(
                    f'[{entity.name}] found pattern "{pattern}" in the field "{field}" of record "{record!r}", letting through')
                return record
        return None


@Plugins.register('filter.exclude', Plugins.kind.ACTOR)
class ExcludeFilter(Filter):
    """
    Drop records with specific words

    This filter lets through records that have none of the values
    defined by `patterns` list found in any (or specified) field of the record.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[MatchFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)
        self.patterns_by_entity = {
            entity.name: [*entity.patterns, *load_patterns_file(entity.patterns_file, self.logger)]
            for entity in entities
        }

    def match(self, entity: MatchFilterEntity, record: Record) -> Optional[Record]:
        for pattern in self.patterns_by_entity.get(entity.name, entity.patterns):
            field = find_matching_field(record, pattern, entity.fields)
            if field is not None:
                self.logger.debug(
                    f'[{entity.name}] found pattern "{pattern}" in the field "{field}" of record "{record!r}", dropping')
                return None
        return record


Plugins.register('filter.event', Plugins.kind.ASSOCIATED_RECORD)(Event)


@Plugins.register('filter.event', Plugins.kind.ACTOR_ENTITY)
class EventFilterEntity(FilterEntity):
    event_types: Optional[List[str]] = None
    """list of event types. See descriptions of plugins producing events for possible values"""


@Plugins.register('filter.event', Plugins.kind.ACTOR)
class EventFilter(Filter):
    """
    Filter for records with "Event" type

    Only lets through Events and not normal Records.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[EventFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: EventFilterEntity, record: Record) -> Optional[Record]:
        if isinstance(record, Event):
            event_types = entity.event_types
            if event_types is None:
                return record
            for event_type in event_types:
                if record.event_type == event_type:
                    return record
        return None


@Plugins.register('filter.event.cause', Plugins.kind.ACTOR)
class EventCauseFilter(Filter):
    """
    Filter for extracting original record from Event

    Take an Event and return the record that was being processed
    when it happened.

    Regular records (not Events) are passed through unchanged.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[EmptyFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: EmptyFilterEntity, record: Record) -> Optional[Record]:
        if isinstance(record, Event):
            return record.record
        return record


@Plugins.register('filter.type', Plugins.kind.ACTOR_ENTITY)
class TypeFilterEntity(FilterEntity):
    types: List[str]
    """list of records class names, such as "Record" and "Event" """
    exact_match: bool = False
    """whether match should check for exact record type or look in entire records hierarchy up to Record"""


@Plugins.register('filter.type', Plugins.kind.ACTOR)
class TypeFilter(Filter):
    """
    Filter for records of specific type

    Only lets through records of specified types, such as `Event` or `YoutubeVideoRecord`.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[TypeFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: TypeFilterEntity, record: Record) -> Optional[Record]:
        if entity.exact_match:
            tested_types = [record.__class__.__name__]
        else:
            tested_types = [t.__name__ for t in record.__class__.mro()]

        for tested_type in tested_types:
            for allowed_type in entity.types:
                if allowed_type == tested_type:
                    return record
        return None


Plugins.register('filter.json', Plugins.kind.ASSOCIATED_RECORD)(TextRecord)


@Plugins.register('filter.json', Plugins.kind.ACTOR_ENTITY)
class JsonFilterEntity(FilterEntity):
    prettify: bool = False
    """whether output should be multiline and indented or a single line"""


@Plugins.register('filter.json', Plugins.kind.ACTOR)
class JsonFilter(Filter):
    """
    Format record as JSON

    Takes record and produces a new `TextRecord` rendering fields of the
    original record in JSON format, with option for pretty-print.
    """

    def __init__(self, config: EmptyFilterConfig, entities: Sequence[JsonFilterEntity], ctx: RuntimeContext):
        super().__init__(config, entities, ctx)

    def match(self, entity: JsonFilterEntity, record: Record) -> TextRecord:
        indent = 4 if entity.prettify else None
        try:
            as_object = json.loads(str(record))
            self.logger.debug(f'text representation of record "{record!r}" is already a valid json')
            as_json = json.dumps(as_object, sort_keys=True, ensure_ascii=False, default=str, indent=indent)
        except json.JSONDecodeError:
            as_json = record.as_json(indent=indent)

        return TextRecord(text=as_json)


@Plugins.register('filter.deduplicate', Plugins.kind.ACTOR_CONFIG)
class DeduplicateFilterConfig(ActorConfig):
    history_dir: Optional[Path] = Field(default='cache/deduplicate/', validate_default=True)
    """directory to store entities history between restarts"""

    @field_validator('history_dir')
    @classmethod
    def check_dir(cls, path: Optional[Path]):
        if path is None:
            return path
        ok = utils.check_dir(path, create=True)
        if ok:
            return path
        else:
            raise ValueError(f'check path "{path}" exists and is a writeable directory')


@Plugins.register('filter.deduplicate', Plugins.kind.ACTOR_ENTITY)
class DeduplicateFilterEntity(FilterEntity):
    field: str = 'hash'
    """field name to use for comparison"""
    history_size: int = 10000
    """how many old records should be kept in memory"""
    history: OrderedDict = Field(exclude=True, repr=False, default=OrderedDict())
    """internal variable to persist state between updates. Used to keep fields of already seen records"""


@Plugins.register('filter.deduplicate', Plugins.kind.ACTOR)
class DeduplicateFilter(Filter):
    """
    Drop already seen records

    Checks if the `field` field value of the current record has already been
    present in one of the previous records and only let it through otherwise.

    `field` might be either a record field name or one of `hash` or `as_json`
    for sha1 and fulltext comparison. If `field` is not present in the current
    record, it will be passed through as if it's new.

    This filter will work with records of any type, as long as they have defined
    field (all records have `hash` and `as_json`). For example, it is possible
    to ensure no multiple records for a single video will be produced
    in a chain, that gather records from Youtube channel and Youtube RSS monitors,
    by passing them to an entity of this filter with `field` set to `video_id`.

    Note, that history is kept in memory, so it will not be persisted between
    restarts.
    """

    def __init__(self, conf: DeduplicateFilterConfig, entities: Sequence[DeduplicateFilterEntity], ctx: RuntimeContext):
        super().__init__(conf, entities, ctx)
        self.conf: DeduplicateFilterConfig
        self.entities: Mapping[str, DeduplicateFilterEntity]  # type: ignore

    def match(self, entity: DeduplicateFilterEntity, record: Record) -> Optional[Record]:
        field = getattr(record, entity.field, None)
        if field is None:
            self.logger.debug(f'[{entity.name}] record has no field {entity.field}, letting it through')
            return record
        if callable(field):
            try:
                value = field()
            except TypeError:
                self.logger.debug(
                    f'[{entity.name}] unsupported "field" value {entity.field}. Should be a property or a method that takes no arguments. All records will be dropped on this filter')
                return None
        else:
            value = field

        value = str(value)  # support non-hashable fields

        if value in entity.history:
            self.logger.debug(f'[{entity.name}] record with {entity.field}={value} has already been seen, dropping')
            return None

        while len(entity.history) >= entity.history_size:
            entity.history.popitem(last=False)

        entity.history[value] = True
        entity.history.move_to_end(value)
        self.logger.debug(f'[{entity.name}] record with {entity.field}={value} has not yet been seen, letting through')
        return record

    async def run(self) -> None:
        if self.conf.history_dir is None:
            return

        for entity in self.entities.values():
            filename = self.conf.history_dir / Path(f'{self.conf.name}-{entity.name}-history.json')
            try:
                if filename.exists() and filename.is_file():
                    with open(filename, 'rt', encoding='utf8') as fp:
                        history = json.load(fp)
                        entity.history.update(history)
                        self.logger.info(
                            f'[{entity.name}] history ({len(entity.history)} items) successfully loaded from {filename}')
            except Exception as e:
                self.logger.info(f'[{entity.name}] failed to load history from "{filename}": {e}')

        try:
            await asyncio.Future()
        except (asyncio.CancelledError, KeyboardInterrupt):
            for entity in self.entities.values():
                if not entity.history:
                    continue
                filename = self.conf.history_dir / Path(f'{self.conf.name}-{entity.name}-history.json')
                try:
                    with open(filename, 'wt', encoding='utf8') as fp:
                        json.dump(entity.history, fp, ensure_ascii=False, indent=4)
                        self.logger.info(
                            f'[{entity.name}] history ({len(entity.history)} items) successfully stored at {filename}')
                except Exception as e:
                    self.logger.info(f'[{entity.name}] failed to store history to "{filename}": {e}')
            raise
