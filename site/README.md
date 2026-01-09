# Collection "Symbole des Weiblichen"

# About the collection

- [**Description**](https://sammlungen.uni-goettingen.de/sammlung/slg_1003/)
- **Selection identifier**: slg_1003

# Additional dependencies

Run the general setup step in the parent directory

```
pip install -r requirements.txt
```

Install the required model for NLP processing since it's enabled by default.

```bash
python -m spacy download de_core_news_lg
```

## Installing the dendencies for the web presentation

```bash
npm i
```

# Running

Start the webserver from this directory:

```
npm run start
```

Open [http://localhost:5173/](http://localhost:5173/) in your browser.

# Building

To bild a deployable static website just run in this directory:

```
npm run build
```

The website will be in `dist`.

# Description

## Getting data

The first step is to get the required IDs for the collection, this can be dome on the command line using `curl`:

```bash
curl -X 'POST' \
  'https://sammlungen.uni-goettingen.de/api/v1/index/query/' \
  -H 'accept: */*' \
  -H 'Content-Type: application/json' \
  -d '{
   "query": "+ISWORK:true +MD_UNIGOE_DC_ONLY_ID:slg_1003",
  "resultFields": [
    "PI*"
  ],
  "sortFields": [
    "SORTNUM_YEAR",
    "LABEL"
  ],
  "sortOrder": "asc",
  "jsonFormat": "recordcentric",
  "count": 1000,
  "offset": 0,
  "randomize": false,
  "language": "de",
  "includeChildHits": false,
  "boostTopLevelDocstructs": false
}'
```

One can **also** use a client like [Yaak](https://yaak.app/) to **send** the **request** using a graphical client.

This is implemented in `scripts/downloader.py`. The script then uses **this** list to download the LIDO file. For each LIDO file, a set of XPath expressions is used to extract the following fields:
* point
* place
* related
* workid
* url
* id
* thumb
* title
* material
* text
* description

The `description` field is post-processed into a field `words`:
* Split into tokens
* Check if tokens are **abbreviations**; if yes, replace them
* Check if tokens are on an **ignore list**; if yes, remove them
* Rejoin the tokens (to have tokens in context again)
* Split again, ignoring stop words
* **Lemmatize** the remaining tokens — tokens aren't deduplicated by design

The `point` field is **post-processed** to get individual coordinates.

The properties above are used to construct a GeoJSON `Feature` for each input document, which are then grouped into a `FeatureCollection`, which in turn is saved to `assets/json/kirchhoff.json`. The **frontend** expects the file to be at this location.

**You need to generate the data for the frontend to work.**
Run this from the parent directory:
```
python scripts/downloader.py
```

Note, that not all extracted fields are used in the frontend.
