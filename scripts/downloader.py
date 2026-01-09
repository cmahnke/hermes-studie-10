import json
import os
import re
import logging
import sys
import argparse
import requests
import pathlib
from lxml import etree
from geojson import  Feature, FeatureCollection, Point
import geojson
import spacy

context_path = os.path.dirname(os.path.realpath(__file__))

data_file = "data.json"
output_data_file = os.path.join(context_path, "../site/assets/json/output.json")
output_geojson = os.path.join(context_path, "../site/assets/json/kirchhoff.json")
frequency_json = os.path.join(context_path, "../site/assets/json/frequency.json")

doc_query = "+ISWORK:true +MD_UNIGOE_DC_ONLY_ID:slg_1003"
api_url = "https://sammlungen.uni-goettingen.de/api/v1/index/query/"
resolver = "http://sammlungen.uni-goettingen.de/lidoresolver?id="
ner = False
nlp = True

namespaces = {"lido": "http://www.lido-schema.org", "gml": "http://www.opengis.net/gml"}

abbreviations = {
    "z.B.": "zum Beispiel",
    "usw.": "und so weiter",
    "bzw.": "beziehungsweise",
    "ca.": "circa",
    "v.a.": "vor allem",
    "Mio.": "Millionen",
    "Lt.": "Laut",
    "sog.": "sogenannte",
    "Dr.": "Doktor",
    "Prof.": "Professor",
    "Nr.": "Nummer",
    "vgl.": "vergleiche",
    "Inv.-Nr.": "Inventarnummer",
    "Inv.-Nr": "Inventarnummer",
    "Röm.-Germ.": " Römisch-Germanisch",
    "S.": "Seite",
    "v.": "vor",
    "n.": "nach",
    "Chr.": "Christus",
    "v.Chr.": "vor Christus",
    "n.Chr.": "nach Christus",
    "d.h.": "das heißt",
    "o.J.": "ohne Jahr",
    "u.a.": "unter anderem",
    "Hg.": "Herausgeber",
    "z.Z.": "zur Zeit",
    "d.s.": "das sind",
    "d.s": "das sind",
    "D.C": "District of Columbia",
    "N.Y.": "New York",
    "P.O.": "Post Office",
    "z.T.": "zum Teil",
}

exclude_patterns = [r'\w\.']

if ner or nlp:
    import de_core_news_lg
    nlp_model = de_core_news_lg.load()
    #nlp_model = spacy.load("de_core_news_lg")
    #nlp = spacy.load('de_dep_news_trf')

# Online XPath tester: https://xpather.com/
paths = {"point": "//lido:eventPlace//gml:Point",
         "place": {"xpath": '//lido:eventPlace//lido:appellationValue[@lido:pref="preferred"]', "type": "text"},
         "related": '//lido:relatedWorkSet//lido:objectNote[@lido:type="workid"]/text()',
         "workid": {"xpath": "//lido:repositoryWrap//lido:workID", "type": "text"},
         "url": {"xpath": "(//lido:objectPublishedID)[1]", "type": "text"},
         "id": {"xpath": "//lido:lidoRecID", "type": "text"},
         "thumb": {"xpath": "(//lido:resourceSet//lido:resourceRepresentation//lido:linkResource)[1]", "type": "text"},
         "title":  {"xpath":"//lido:titleWrap//lido:appellationValue", "type": "text"},
         "material": {"xpath":"//lido:eventMaterialsTech//lido:termMaterialsTech//lido:term[not(@xml:lang)]", "type": "text"},
         "description":  {"xpath": '//lido:objectDescriptionWrap//lido:descriptiveNoteValue', "type": "text"}}

compiled_patterns = []
for pattern in exclude_patterns:
    try:
        compiled_patterns.append(re.compile(pattern))
    except re.error as e:
        logger.warning(f"Warning: Invalid regex pattern '{pattern}' skipped. Error: {e}")
        continue

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

def document_embedding(text, model):
    words = text.lower().split()
    valid_words = [word for word in words if word in model.wv]
    if not valid_words:
        return np.zeros(model.vector_size).tolist()

    document_vector = np.mean([model.wv[word] for word in valid_words], axis=0)
    return document_vector.tolist()

def reduced_embeddings(vectors_to_reduce, method='tsne', n_components=2):
    if not vectors_to_reduce:
        logger.error("No vectors provided for reduction.")
        return []

    vectors_to_reduce_np = np.array(vectors_to_reduce)
    if vectors_to_reduce_np.ndim == 1:
        vectors_to_reduce_np = vectors_to_reduce_np.reshape(1, -1)

    print(f"Applying {method.upper()} to {len(vectors_to_reduce_np)} vectors...")

    n_samples = len(vectors_to_reduce_np)
    if n_samples == 1:
        print("Only 1 vector provided. Dimensionality reduction is trivial; returning original vector(s).")
        if n_components > vectors_to_reduce_np.shape[1]:
            padded_vector = np.pad(vectors_to_reduce_np[0], (0, n_components - vectors_to_reduce_np.shape[1]), 'constant').tolist()
            return [padded_vector]
        else:
            return vectors_to_reduce_np[:, :n_components].tolist()

    if method == 'tsne':
        perplexity_val = min(30, n_samples - 1) if n_samples > 1 else 1
        reducer = TSNE(n_components=n_components, random_state=42, perplexity=perplexity_val,
                       learning_rate='auto', init='random', n_jobs=-1)
    elif method == 'umap':
        n_neighbors_val = min(15, n_samples - 1) if n_samples > 1 else 1
        reducer = umap.UMAP(n_components=n_components, random_state=42, n_neighbors=n_neighbors_val, min_dist=0.1)
    else:
        raise ValueError("Invalid reduction method. Choose 'tsne' or 'umap'.")

    reduced_vectors = reducer.fit_transform(vectors_to_reduce_np)
    logger.info("Dimensionality reduction complete.")
    return reduced_vectors.tolist()

def query_index(
    query: str,
    result_fields: list = ["PI*", "LABEL"],
    sort_order: str = "asc",
    json_format: str = "recordcentric",
    count: int = 1000,
    offset: int = 0,
    randomize: bool = False,
    language: str = "en",
    include_child_hits: bool = False,
    boost_top_level_docstructs: bool = False,
    api_url: str = api_url
):

    headers = {
        'accept': '*/*',
        'Content-Type': 'application/json'
    }

    payload = {
        "query": query,
        "resultFields": result_fields,
        "sortOrder": sort_order,
        "jsonFormat": json_format,
        "count": count,
        "offset": offset,
        "randomize": randomize,
        "language": language,
        "includeChildHits": include_child_hits,
        "boostTopLevelDocstructs": boost_top_level_docstructs
    }

    response = requests.post(api_url, headers=headers, data=json.dumps(payload))
    response.raise_for_status()
    return response.json()


def download_lido(urls, xpath_expressions_config, namespace_map=namespaces):
    results = []

    if namespace_map is None:
        namespace_map = {}

    c = 1
    for url in urls:
        logger.info(f"Processing XML URL: {url} ({c}/{len(urls)})")
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()

            root = etree.fromstring(response.content)

            extracted_data = {}
            for field_name, config in xpath_expressions_config.items():
                if not isinstance(config, dict):
                    xpath_expr = config
                    return_type = "xml"
                else:
                    xpath_expr = config['xpath']
                    return_type = config.get('type', 'text').lower()

                try:
                    elements = root.xpath(xpath_expr, namespaces=namespace_map)

                    if elements:
                        processed_elements = []
                        for e in elements:
                            if return_type == 'xml':
                                if isinstance(e, etree._Element):
                                    processed_elements.append(etree.tostring(e, pretty_print=True, encoding='unicode').strip())
                                else:
                                    processed_elements.append(str(e).strip())
                            else:
                                if hasattr(e, 'text') and e.text is not None:
                                    processed_elements.append(e.text.strip())
                                else:
                                    processed_elements.append(str(e).strip())

                        if len(processed_elements) == 1:
                            extracted_data[field_name] = processed_elements[0]
                        else:
                            if return_type == 'text':
                                extracted_data[field_name] = "\n".join(processed_elements)
                            else:
                                extracted_data[field_name] = processed_elements
                    else:
                        extracted_data[field_name] = None
                except Exception as xpath_error:
                    logger.error(f"Error applying XPath '{xpath_expr}' for field '{field_name}' on {url}: {xpath_error}")
                    extracted_data[field_name] = None

            results.append(extracted_data)
            c += 1

        except etree.XMLSyntaxError as e:
            logger.error(f"Error parsing XML from {url}: {e}")
            results.append({field: None for field in xpath_expressions_config.keys()})
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading {url}: {e}")
            results.append({field: None for field in xpath_expressions_config.keys()})
        except Exception as e:
            logger.error(f"An unexpected error occurred while processing {url}: {e}")
            results.append({field: None for field in xpath_expressions_config.keys()})

    return results


def extract_words(text):
    if nlp_model is None:
        logger.warning("Spacy German model not loaded. Cannot process text.")
        return []

    if not text.strip():
        return []

    doc = nlp_model(text)
    expanded_tokens = []
    for token in doc:
        token_text = token.text
        expanded = False
        if token_text in abbreviations:
            expanded_token = abbreviations[token_text]
            expanded = True
        else:
            expanded_token = token_text

        match_found = False
        if not expanded:
            for compiled_pattern in compiled_patterns:
                if compiled_pattern.match(token.text):
                    match_found = True
                    logger.warning(f"Ignoring token {token.text}")
                    break

        if not match_found:
            expanded_tokens.append(expanded_token)

    expanded_text = " ".join(expanded_tokens)
    expanded_text = expanded_text.replace(" .", ".").replace(" ,", ",").replace(" )", ")").replace("( ", "(")

    doc_expanded = nlp_model(expanded_text)

    words = []

    for token in doc_expanded:
        if not token.is_stop and not token.is_punct and not token.is_space and not token.like_num:
            word = token.lemma_
            if word in abbreviations:
                word = abbreviations[word]
            words.append(word)

    return words

# Viewer for the result: https://geojson.tools/
def convert_to_geojson(data):
    features = []
    works = {}

    for item in data:
        logger.info(f"Processing GeoJSON for {item.get("id", "")}")
        try:
            root = etree.fromstring(item["point"])
            pos_elements = root.xpath('//gml:pos/text()', namespaces=namespaces)
            coordinates_elements = root.xpath('//gml:coordinates/text()', namespaces=namespaces)

            if pos_elements:
                coordinate_string = pos_elements[0].strip()
                separator = ' '
            elif coordinates_elements:
                coordinate_string = coordinates_elements[0].strip()
                separator = ','
            else:
                return None

            coords_str_list = coordinate_string.split(separator)
            # wgs84_pos:lat
            lat = float(coords_str_list[0])
            # wgs84_pos:lon
            lon = float(coords_str_list[1])

            point = Point((lon, lat))
        except:
            point = None
            logger.warning(f"Failed to parse point of {item.get("id", "")}")

        properties = {"thumb": item.get("thumb", ""), "id": item.get("id", ""), "workid": item.get("workid", ""), "title": item.get("title", ""), "place": item.get("place", ""), "url": item.get("url", ""), "related": item.get("related", "")}
        if "material" in item and item["material"] is not None:
            properties["material"] = item.get("material", "").replace('\n', ' ')

        if "description" in item and item["description"] is not None:
            description = item.get("description", "").replace("\n", ' ')
            properties["description"] = description
            if nlp:
                properties["words"] = extract_words(description)
            if ner:
                analyzed = nlp_model(description)
                entities = []
                for entity in analyzed.ents:
                    entities.append({"text": entity.text, "label": entity.label_})

                properties["entities"] = entities

        if "workid" in item and "url" in item:
            works[item["workid"]] = item["url"]

        feature = Feature(geometry=point, properties=properties)
        features.append(feature)

    for i in range(len(features)):
        feature = features[i]
        if "related" in feature["properties"] and feature["properties"]["related"] is not None:
            if isinstance(feature["properties"]["related"], str):
                related = [feature["properties"]["related"]]
            elif isinstance(feature["properties"]["related"], list):
                related = feature["properties"]["related"]
            else:
                raise Exception("related item mst be None, str or list")
            for r in related:
                if r in works.keys():
                    related.append(works[r])
            feature["properties"]["related"] = related
        elif feature["properties"]["related"] is None:
            del feature["properties"]["related"]
        features[i] = feature

    return FeatureCollection(features)

def word_frequency(data):
    all_words = {}
    for feature in data["features"]:
        if "words" in feature["properties"]:
            url = feature["properties"]["url"]

            for word in feature["properties"]["words"]:
                if word in all_words:
                    all_words[word].append(url)
                else:
                    all_words[word] = [url]
    return dict(sorted(all_words.items(), key=lambda item: len(item[1]), reverse=True))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog='downloader.py')
    parser.add_argument('--nlp', '-n', action='store_true', default=nlp, help='Do simple NLP processing for word cloud')
    parser.add_argument('--geojson', '-g', type=pathlib.Path, default=output_geojson, help=f'GeoJSON for further processing (default {output_geojson})')
    parser.add_argument('--output', '-o', type=pathlib.Path, default=output_data_file, help=f'Output file (default {output_data_file})')
    parser.add_argument('--input', '-i', type=pathlib.Path, help='Input file')
    args = parser.parse_args()

    if args.geojson:
        output_geojson_file = args.geojson
    else:
        output_geojson_file = output_geojson

    if args.output:
        output_file = args.output
    else:
        output_file = output_data_file

    if args.input:
        with open(args.input) as f:
            extracted = json.load(f)
        logger.info(f"Loaded data from {args.input}")
    else:
        logger.info(f"Get identifiers for query {doc_query} from {api_url}")
        data = query_index(doc_query)
        ids = []
        for doc in data["docs"]:
            ids.append(resolver + doc["Identifier"])
        logger.info("Generated LIDO URL list")

        extracted = download_lido(ids, paths)

    with open(output_file, 'w') as f:
        json.dump(extracted, f, indent=4)
    feature_collection = convert_to_geojson(extracted)
    with open(output_geojson_file, 'w') as g:
        geojson.dump(feature_collection, g, indent=4)
    with open(frequency_json, 'w') as f:
        json.dump(word_frequency(feature_collection), f, indent=4)
