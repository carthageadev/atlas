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
scraper/  crawler (sometimes called scraper)
data/     roms.json + meta.json
site/     frontend
```
