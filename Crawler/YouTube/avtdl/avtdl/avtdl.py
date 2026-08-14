#!/usr/bin/env python3

import argparse
import asyncio
import logging
from asyncio import AbstractEventLoop
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from avtdl.core.actors import Actor
from avtdl.core.chain import Chain
from avtdl.core.config import ConfigParser, ConfigurationError, SettingsSection, config_sancheck
from avtdl.core.loggers import setup_console_logger, silence_library_loggers
from avtdl.core.plugins import UnknownPluginError
from avtdl.core.runtime import RuntimeContext, TerminatedAction
from avtdl.core.utils import read_file, write_file
from avtdl.core.yaml import yaml_load

try:
    from avtdl._version import __version__
except ImportError:
    __version__ = 'local'

DEFAULT_CONFIG_PATH = Path('config.yml')
CONFIG_TEMPLATE = '''
settings:
  log_directory: "runtime/youtube/logs"
  cache_directory: "runtime/youtube/cache"
  state_directory: "runtime/youtube/state"

actors:
  channel:
    config:
      db_path: "runtime/youtube/db"
    entities:
      - name: "youtube keyword search"
        url: "https://www.youtube.com/results?search_query=YouTube"
        update_interval: 900
        quiet_first_time: true
        max_continuation_depth: 1
  filter.match:
    entities:
      - name: "youtube keywords"
        patterns:
          - "YouTube"
        fields:
          - "title"
          - "summary"
          - "author"
  mattermost:
    config:
      base_url: "https://kan.cool"
      env_file: "F:\\AgentHub\\env\\Crawler_env\\YouTube_env"
    entities:
      - name: "kan keyword groups"
        channels: []

chains:
  "youtube keyword monitor":
    - channel:
        - "youtube keyword search"
    - filter.match:
        - "youtube keywords"
    - mattermost:
        - "kan keyword groups"
'''


def load_config(path: Path, encoding: Optional[str] = None) -> Any:
    try:
        if not path.exists():
            alt_path = path.with_suffix(path.suffix + '.txt')
            if alt_path.exists():
                print(f'Configuration file {path} not found, trying {alt_path} instead.')
                path = alt_path
            elif path == DEFAULT_CONFIG_PATH:
                print(f'Configuration file {path} not found, using example template.')
                write_file(path, CONFIG_TEMPLATE)
            else:
                raise ValueError('Configuration file {} does not exist'.format(path))
        config_text = read_file(path, encoding=encoding)
        config = yaml_load(config_text)
    except Exception as e:
        print('Failed to parse configuration file:')
        print(e)
        raise SystemExit from e
    return config


def parse_config(conf, ctx: RuntimeContext) -> Tuple[SettingsSection, Dict[str, Actor], Dict[str, Chain]]:
    try:
        settings, actors, chains = ConfigParser.parse(conf, ctx)
    except (ConfigurationError, UnknownPluginError) as e:
        logging.error(e)
        raise SystemExit from e
    except Exception as e:
        logging.exception(e)
        raise SystemExit from e
    return settings, actors, chains


def handler(loop: AbstractEventLoop, context: Dict[str, Any]) -> None:
    logging.exception(f'unhandled exception in event loop:', exc_info=context.get('exception'))
    loop.default_exception_handler(context)


async def install_exception_handler() -> None:
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(handler)
    loop.slow_callback_duration = 100



async def run(config_path: Path) -> None:
    await install_exception_handler()
    config_encoding: Optional[str] = None
    while True:
        config = load_config(config_path, config_encoding)
        ctx = RuntimeContext.create()
        with ctx:
            settings, actors, chains = parse_config(config, ctx)
            if config_encoding != settings.encoding:
                config_encoding = settings.encoding
                logging.debug(f'configuration file encoding is explicitly set to "{settings.encoding}", reloading the file')
                continue
            if settings.encoding is None:
                logging.info(f'configuration file will be written on disk in UTF8 encoding. This can be changed by explicitly setting "encoding" option in the "Settings" section')
                settings.encoding = 'utf8'

            config_sancheck(actors, chains)

            ctx.bus.apply_state(settings.state_directory)

            controller = ctx.controller
            for runnable in actors.values():
                _ = controller.create_task(runnable.run(), name=f'{runnable!r}.{hash(runnable)}')
            action = await controller.run_until_termination()

            ctx.bus.dump_state(settings.state_directory)

            if action == TerminatedAction.EXIT:
                logging.info('terminating...')
                break
            elif action == TerminatedAction.RESTART:
                logging.info('restarting...')
                continue
            else:
                assert False, f'Unknown action: {action}'


def main() -> None:
    description = '''Tool for monitoring YouTube keyword search results and sending notifications'''
    parser = argparse.ArgumentParser(description=description)
    help_d = 'set loglevel to DEBUG'
    parser.add_argument('-d', '--debug', action='store_true', default=False, help=help_d)
    help_v = 'print version and exit'
    parser.add_argument('-v', '--version', action='store_true', default=False, help=help_v)
    help_c = 'specify path to configuration file to use instead of default'
    parser.add_argument('-c', '--config', type=Path, default=DEFAULT_CONFIG_PATH, help=help_c)
    args = parser.parse_args()

    if args.debug:
        log_level = logging.DEBUG
    else:
        log_level = logging.INFO

    setup_console_logger(log_level)
    silence_library_loggers()

    try:
        if args.version:
            print(f'avtdl {__version__}')
        else:
            asyncio.run(run(args.config), debug=True)
    except KeyboardInterrupt:
        if args.debug:
            logging.exception('Interrupted, exiting... Printing stacktrace for debugging purpose:')
        else:
            logging.info('Interrupted, exiting...')


if __name__ == "__main__":
    main()
