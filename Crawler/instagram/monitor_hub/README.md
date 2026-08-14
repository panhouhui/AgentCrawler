# Monitor Hub

Unified scheduler for the sibling `instaloader` and `Threads-Scraper` projects.

This folder owns:

- polling / watch loop
- SQLite dedupe state
- Mattermost / kan.cool push
- unified event format

The sibling projects own only crawling:

- `../instaloader`: Instagram hashtag crawling
- `../Threads-Scraper`: Threads user crawling

## Setup

Copy `.env.example` to `.env` and fill real secrets:

```env
KAN_COOL_BOT_TOKEN=your_real_token
MATTERMOST_URL=https://kan.cool
MATTERMOST_CHANNEL_IDS=1a6ftqghrjnd3yhupmmxtth1sc,jou4418abjf6iemtd1unmbprjh,kqunebxqoifoic5m1ybtnsuxmy,d74in5fw7pbm3dbj4dos7bhfba
INSTAGRAM_LOGIN=yangpeng2026
THREADS_COOKIE=
```

Create the Threads users config file from the example. AgentHub autonomous discovery no longer requires hashtag or text-filter files:

```bat
copy config\threads_users.example.txt config\threads_users.txt
```

## Run Once

```bat
python main.py --all --once
```

With push:

```bat
python main.py --all --once --push
```

## Watch

```bat
python main.py --all --interval 300 --push
```

## Source-Specific Runs

Instagram only:

```bat
python main.py --instagram --once
```

Threads only:

```bat
python main.py --threads --once
```

Use Threads offline mode for testing:

```bat
python main.py --threads --once --no-threads-online
```

## Dedupe

Seen posts are stored in `state/seen.sqlite3`.
If the process crashes and restarts, already-seen posts will not be pushed again.
