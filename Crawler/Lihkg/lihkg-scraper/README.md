# lihkg-scraper

A Python script for scraping LIHKG and saving the data to a local file.

The previous version, which is elegant but no longer work, can be found in the [`v1`](https://github.com/ayaka14732/lihkg-scraper/tree/v1) branch.

## Prerequisites

The script is designed to be executed on a typical Ubuntu 20.04 VPS server.

Install Chrome:

```sh
sudo apt install -y unzip xvfb libxi6 libgconf-2-4
curl -sS -o - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add
echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' | sudo tee -a /etc/apt/sources.list.d/google-chrome.list
sudo apt update -y
sudo apt install -y google-chrome-stable
```

Install ChromeDriver:

```sh
wget https://chromedriver.storage.googleapis.com/98.0.4758.80/chromedriver_linux64.zip
unzip chromedriver_linux64.zip
rm -f chromedriver_linux64.zip
sudo mv chromedriver /usr/bin
```

Install Xvfb:

```sh
sudo apt install -y xvfb xserver-xephyr tigervnc-standalone-server x11-utils gnumeric
```

Install Python dependencies:

```sh
pip install -r requirements.txt
```

The script is also tested on Arch Linux. In this case, you can install the dependencies from `pacman`.

## Usage

The script is designed to be executed with a HTTP proxy server with authentication.

```sh
export FROM_THREAD 800000
export TO_THREAD 900000
export PROXY_HOST 127.0.0.1
export PROXY_PORT 20000
export PROXY_USER testuser
export PROXY_PASS test123
python main.py $FROM_THREAD $TO_THREAD $PROXY_HOST $PROXY_PORT $PROXY_USER $PROXY_PASS
```

You need to modify the values according to your demand and your configuration.

## Scrape latest and hot category threads

Use `scrape_category.py` to scrape the latest and hot thread lists from a
category, including each thread URL and comments in each thread. It keeps a
state file to avoid writing duplicate threads and comments.

Copy `.env.example` to `.env` and configure all crawler settings there:

```sh
cp .env.example .env
```

Important `.env` fields:

```dotenv
LIHKG_CAT_ID=1
LIHKG_TYPES=now,hot
LIHKG_MAX_THREAD_AGE_DAYS=3
LIHKG_REQUEST_DELAY=5
LIHKG_INTERVAL=300
LIHKG_TAIL_EXISTING=true
LIHKG_COOKIE=cf_clearance=...; other_cookie=...
LIHKG_PROXY=
LIHKG_OUTPUT=data/lihkg-events.jsonl
LIHKG_STATE=data/lihkg-state.json
```

The real `.env` file is ignored by Git because it may contain cookies or proxy
credentials.

```sh
pip install -r requirements.txt
python src/scrape_category.py once
```

Useful options:

```sh
python src/scrape_category.py once
```

To continuously monitor new latest/hot threads:

```sh
python src/scrape_category.py watch
```

The output is JSONL. Each line contains one thread with fields such as
`thread_id`, `url`, `title`, `source_list`, `total_page`, and `comments`.
Comment records include `post_id`, `msg_num`, `url`, `text`, `html`, and
`links`. The state file stores seen `thread_id` and `post_id` values, so reruns
and watch cycles only append newly discovered data.

`LIHKG_MAX_THREAD_AGE_DAYS=3` keeps monitoring focused on currently fresh
latest/hot threads. Set it to `0` only if you want to include older hot threads.

LIHKG may return `429 Too Many Requests` when requests are too frequent. Increase
`--request-delay`, `--interval`, or `--backoff-base` if that happens. Use
`--max-rate-limit-wait` to skip the current request instead of blocking the
monitor for too long.

Command-line arguments still work and override `.env` values:

```sh
python src/scrape_category.py watch --interval 120 --request-delay 3
```

If the server needs a proxy, set `LIHKG_PROXY` in `.env`:

```dotenv
LIHKG_PROXY=http://user:pass@127.0.0.1:20000
```

`--tail-existing` reduces requests during monitoring. New threads are fetched
from page 1, while known threads are fetched from their previous last page so
new replies can still be discovered without repeatedly crawling the whole
thread.

Run tests:

```sh
python -m unittest -v
```
