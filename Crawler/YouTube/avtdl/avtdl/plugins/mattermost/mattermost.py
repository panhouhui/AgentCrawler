import logging
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set

from pydantic import AnyHttpUrl, Field

from avtdl.core.actions import QueueAction, QueueActionConfig, QueueActionEntity
from avtdl.core.formatters import Fmt
from avtdl.core.interfaces import Record
from avtdl.core.plugins import Plugins
from avtdl.core.request import HttpClient, RequestDetails, RetrySettings
from avtdl.core.runtime import RuntimeContext

CRAWLER_ROOT = Path(__file__).resolve().parents[5]
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))

from kan_push_bridge import KanPushError, dispatch_kan_message

DEFAULT_TOKEN_ENV = 'OPENCROW_KAN_PUSH_TOKEN'


def load_env_file(path: Path, logger: logging.Logger) -> Dict[str, str]:
    values: Dict[str, str] = {}
    try:
        lines = path.read_text(encoding='utf8').splitlines()
    except FileNotFoundError:
        logger.warning(f'env file "{path}" does not exist')
        return values
    except OSError as e:
        logger.warning(f'failed to read env file "{path}": {e}')
        return values

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[len('export '):].strip()
        if '=' not in line:
            logger.warning(f'skipping malformed line {line_number} in env file "{path}"')
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


@Plugins.register('mattermost', Plugins.kind.ACTOR_CONFIG)
class MattermostConfig(QueueActionConfig):
    base_url: AnyHttpUrl = 'http://127.0.0.1:48080/api/kan-push/dispatch'
    """OpenCrow Kan push dispatch URL"""
    env_file: Path = Path(r'F:\AgentHub\env\Crawler_env\YouTube_env')
    """path to a .env file containing the OpenCrow API token when needed"""
    token_env: str = DEFAULT_TOKEN_ENV
    """environment variable name used to read the OpenCrow API token from env_file"""
    sent_history_file: Path = Path('runtime/youtube/state/mattermost_sent.json')
    """path to a JSON file containing already sent record ids"""


@Plugins.register('mattermost', Plugins.kind.ACTOR_ENTITY)
class MattermostEntity(QueueActionEntity):
    channels: List[str] = Field(min_length=1)
    """Mattermost channel ids to post into"""
    message_template: Optional[str] = None
    """optional template used to format the message. If omitted, record text representation is used"""


@Plugins.register('mattermost', Plugins.kind.ACTOR)
class MattermostAction(QueueAction):
    """
    Send records through OpenCrow to Kan channels

    Posts incoming records to one or more Kan channels via OpenCrow's central
    dispatch API. The Kan bot token stays in OpenCrow instead of this crawler.
    """

    def __init__(self, conf: MattermostConfig, entities: Sequence[MattermostEntity], ctx: RuntimeContext):
        super().__init__(conf, entities, ctx)
        self.conf: MattermostConfig
        self.entities: Dict[str, MattermostEntity]  # type: ignore
        self.token: Optional[str] = None
        self.sent_history: Set[str] = set()

    def load_token(self) -> Optional[str]:
        env = load_env_file(self.conf.env_file, self.logger)
        token = env.get(self.conf.token_env)
        if not token:
            self.logger.warning(
                f'OpenCrow token "{self.conf.token_env}" was not found in env file "{self.conf.env_file}"; trying unauthenticated local dispatch'
            )
            return None
        return token

    async def run(self) -> None:
        self.token = self.load_token()
        self.sent_history = self.load_sent_history()
        await super().run()

    def load_sent_history(self) -> Set[str]:
        path = self.conf.sent_history_file
        try:
            data = json.loads(path.read_text(encoding='utf8'))
        except FileNotFoundError:
            return set()
        except (OSError, json.JSONDecodeError) as e:
            self.logger.warning(f'failed to load Mattermost sent history from "{path}": {e}')
            return set()
        if not isinstance(data, list):
            self.logger.warning(f'failed to load Mattermost sent history from "{path}": expected JSON list')
            return set()
        return {str(item) for item in data}

    def store_sent_history(self) -> None:
        path = self.conf.sent_history_file
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(sorted(self.sent_history), ensure_ascii=False, indent=2), encoding='utf8')
        except OSError as e:
            self.logger.warning(f'failed to store Mattermost sent history to "{path}": {e}')

    def sent_key(self, record: Record) -> str:
        video_id = getattr(record, 'video_id', None)
        if video_id:
            return f'video:{video_id}'
        url = getattr(record, 'url', None)
        if url:
            return f'url:{url}'
        return f'hash:{record.hash()}'

    def endpoint_url(self) -> str:
        base = str(self.conf.base_url).rstrip('/')
        return base

    def prepare_message(self, entity: MattermostEntity, record: Record) -> str:
        if entity.message_template is None:
            return str(record)
        return Fmt.format(entity.message_template, record, tz=entity.timezone)

    async def handle_single_record(self, logger: logging.Logger, client: HttpClient,
                                   entity: MattermostEntity, record: Record) -> None:
        key = self.sent_key(record)
        if key in self.sent_history:
            logger.info(f'[{entity.name}] record "{key}" was already sent to Kan, skipping duplicate')
            return

        message = self.prepare_message(entity, record)

        sent_count = 0
        for channel_id in entity.channels:
            try:
                dispatch_kan_message(
                    platform='youtube',
                    route_id='youtube-kan',
                    message=message,
                    channel_ids=[channel_id],
                    source='youtube-avtdl',
                    dedupe_key=key,
                    metadata={'entity': entity.name},
                    auth_token=self.token,
                    timeout=20,
                )
                sent_count += 1
                logger.debug(f'[{entity.name}] sent record through OpenCrow to Kan channel "{channel_id}"')
                continue
            except KanPushError as e:
                logger.warning(f'[{entity.name}] failed to dispatch record to Kan channel "{channel_id}": {e}')
                continue
            logger.warning(
                f'[{entity.name}] failed to send record through OpenCrow to Kan channel "{channel_id}"'
            )
        if sent_count == len(entity.channels):
            self.sent_history.add(key)
            self.store_sent_history()
