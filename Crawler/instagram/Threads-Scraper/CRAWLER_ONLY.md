# Threads-Scraper Role

This project is kept as the Threads crawling source.

It should be called by the sibling `../monitor_hub` scheduler for:

- polling
- dedupe
- Mattermost / kan.cool push
- combined Instagram + Threads operation

Direct local test:

```bat
python src\main.py --offline -u zuck --limit 1
```

Online crawl test:

```bat
python src\main.py --online -u zuck --limit 5
```
