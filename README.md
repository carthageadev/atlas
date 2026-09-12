# atlas

Search from https://92.35.124.13

Live at https://carthageadev.github.io/atlas

## How it works
Program runs weekly and builds `data/roms.json`. Frontend loads the archive and searches in the browser.

## Mandatory run locally section
```
pip install -r scraper/requirements.txt
python scraper/scraper.py
python -m http.server 8000
# open http://localhost:8000/site/
```

## Layout
```
scraper/  crawler
data/     roms.json + meta.json
site/     frontend
```

## Deploy
Actions run weekly. It fetches and builds then deploys to Pages.
