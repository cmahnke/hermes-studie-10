import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import OSM from "ol/source/OSM.js";
import GeoJSON from "ol/format/GeoJSON.js";
import VectorSource from "ol/source/Vector.js";
import VectorLayer from "ol/layer/Vector.js";
import Overlay from "ol/Overlay.js";
import MapBrowserEvent from "ol/MapBrowserEvent";
import { Coordinate } from "ol/coordinate";
import OLPoint from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import d3Cloud, { Word } from "d3-cloud";
import * as d3 from "d3";
import Cluster from "ol/source/Cluster.js";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import OLFeature from "ol/Feature.js";
import {
  Feature,
  FeatureCollection,
  Geometry, // Keep Geometry for general GeoJSON feature types
  GeoJsonProperties,
  Point as GeoJSONPoint, // Import GeoJSON Point specifically
  LineString as GeoJSONLineString,
  Point
} from "geojson";

import geojson from "../json/kirchhoff.json";
const filteredGeojson: FeatureCollection = geojson as FeatureCollection;

interface SolrDocument {
  [key: string]: string | string[];
}

interface SolrRecordcentricResponse {
  docs: SolrDocument[];
  numFound: number;
}

interface WordCloudWord extends Word {
  text: string;
  size: number;
  value: number;
  urls?: URL[];
}

const selector = ".tag-cloud";
const cloudLimit = 3;
const cloudHeight = window.innerHeight / 2 - document.querySelector<HTMLDivElement>(".input")!.getBoundingClientRect().height;
const cloudWidth = window.innerWidth;
document.querySelector<HTMLDivElement>(".map")!.style.height = window.innerHeight / 2 + "px";

const filterInput = document.getElementById("filter") as HTMLInputElement;
const invert = document.getElementById("invert") as HTMLInputElement;

function wordFrequency(data: FeatureCollection): { [word: string]: URL[] } {
  const allWords: { [word: string]: URL[] } = {};

  for (const feature of data.features) {
    if (feature.properties && feature.properties.words) {
      const url = new URL(feature.properties.url);

      for (const word of feature.properties.words) {
        if (allWords[word]) {
          allWords[word].push(url);
        } else {
          allWords[word] = [url];
        }
      }
    }
  }
  return allWords;
}

function filterFeatures(
  featureCollection: FeatureCollection,
  searchTerm: string,
  includeMatch: boolean,
  caseSensitive: boolean = false
): FeatureCollection {
  const filteredFeatures: Feature[] = [];
  searchTerm = searchTerm.trim();
  let terms: string[] = [];
  if (searchTerm === "") {
    return featureCollection;
  } else if (searchTerm.includes(" ")) {
    terms = searchTerm.split(" ");
  } else {
    terms = [searchTerm];
  }
  for (const term of terms) {
    if (term === "") {
      continue;
    }
    const effectiveSearchTerm = caseSensitive ? term : term.toLowerCase();
    for (const feature of featureCollection.features) {
      const description = feature.properties?.description;

      if (typeof description === "string") {
        const effectiveDescription = caseSensitive ? description : description.toLowerCase();
        const matches = effectiveDescription.includes(effectiveSearchTerm);

        if (includeMatch && matches) {
          filteredFeatures.push(feature);
        } else if (!includeMatch && !matches) {
          filteredFeatures.push(feature);
        }
      } else {
        if (!includeMatch) {
          filteredFeatures.push(feature);
        }
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: filteredFeatures
  };
}

function cloud(filteredGeojson: FeatureCollection) {
  const words = wordFrequency(filteredGeojson);
  document.querySelector<HTMLDivElement>(selector)!.innerHTML = "";
  WordCloud(words, selector, cloudHeight, cloudWidth, 10);
}

function WordCloud(wordList: { [word: string]: URL[] }, selector: string, height = 500, width = 1000, min = cloudLimit) {
  let words: { text: string; value: number }[] = Object.entries(wordList).map(([text, urls]) => {
    const size = urls.length;
    return { text: text, value: size };
  });

  words = words.filter((w) => {
    return w.value >= min;
  });

  if (words.length === 0) {
    d3.select(selector).append("div").text("No words to display based on current filter.");
    return;
  }

  const minWordValue = d3.min(words, (d) => d.value) || min;
  const maxWordValue = d3.max(words, (d) => d.value) || minWordValue + 1;

  const fontSizeScale = d3
    .scaleSqrt()
    .domain([minWordValue, maxWordValue])
    .range([10, Math.min(width, height) / 8]);

  function draw(words: { text: string; value: number }[]) {
    d3.select(selector).select("svg").remove();

    d3.select(selector)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", "translate(" + layout.size()[0] / 2 + "," + layout.size()[1] / 2 + ")")
      .selectAll("text")
      .data(words)
      .enter()
      .append("text")
      .text((d) => d.text)
      .style("font-size", (d: Word) => d.size + "px")
      .style("font-family", (d: Word) => d.font!)
      .style("fill", (d, i) => d3.schemeCategory10[i % 10])
      .attr("text-anchor", "middle")
      .style("font-family", "League Spartan Variable")
      .attr("transform", (d: Word) => "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")");
  }

  const layout = d3Cloud()
    .size([width, height])
    .words(words)
    .padding(1)
    .rotate((word) => {
      const rotations = [0, 90, -90];
      return rotations[Math.floor(Math.random() * rotations.length)];
    })
    .font("League Spartan Variable")
    .fontSize((d: WordCloudWord) => fontSizeScale(d.value))
    .on("end", draw);
  layout.start();
}

function preprocess(data: SolrRecordcentricResponse): FeatureCollection {
  const features: Feature[] = [];
  for (const doc of data.docs) {
    let geometry: Geometry | null = null;

    if ("Koordinaten des Standorts" in doc) {
      const coords: string[] = doc["Koordinaten des Standorts"][0].split(" ");
      geometry = {
        type: "Point",
        coordinates: [Number(coords[1]), Number(coords[0])]
      } as GeoJSONPoint;
    }

    const properties: GeoJsonProperties = {};
    for (const key in doc) {
      properties[key] = doc[key];
    }
    if (geometry !== null) {
      features.push({
        type: "Feature",
        geometry: geometry,
        properties: properties
      });
    }
  }

  return {
    type: "FeatureCollection",
    features: features
  };
}

const parser = new GeoJSON({
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857"
});

const vectorSource: VectorSource = new VectorSource({
  features: parser.readFeatures(filteredGeojson)
});

const clusterSource = new Cluster({
  distance: 45,
  source: vectorSource
});

const styleCache: { [key: number]: Style } = {};

const clusters = new VectorLayer({
  source: clusterSource,
  style: function (feature) {
    const size = feature.get("features").length;
    let style = styleCache[size];
    if (!style) {
      style = new Style({
        image: new Circle({
          radius: 10 + size * 0.4,
          stroke: new Stroke({
            color: "#fff"
          }),
          fill: new Fill({
            color: "#3399CC"
          })
        }),
        text: new Text({
          text: size.toString(),
          fill: new Fill({
            color: "#fff"
          })
        })
      });
      styleCache[size] = style;
    }
    return style;
  }
});

const singlePointStyle = new Style({
  image: new Circle({
    radius: 7,
    stroke: new Stroke({
      color: "#fff"
    }),
    fill: new Fill({
      color: "#3399CC"
    })
  })
});

const spiderfyLayer = new VectorLayer({
  source: new VectorSource(),
  style: (feature) => {
    if (feature.get("isSpiderfyLine")) {
      return new Style({
        stroke: new Stroke({
          color: "rgba(0, 0, 0, 0.5)",
          width: 1,
          lineDash: [4, 4]
        })
      });
    }
    return singlePointStyle;
  }
});

let currentSpiderfyFeatures: OLFeature[] = [];
let currentClusterCenter: Coordinate | undefined;

function updateFilter() {
  const filter = filterInput.value;
  const i = invert.checked;
  const filteredData = filterFeatures(geojson as FeatureCollection, filter, i);
  vectorSource.clear();
  vectorSource.addFeatures(parser.readFeatures(filteredData));
  spiderfyLayer.getSource()!.clear();
  currentSpiderfyFeatures = [];
  currentClusterCenter = undefined;
  cloud(filteredData);
}

const view = new View({
  center: [0, 0],
  zoom: 2
});

function areAllFeaturesAtSameLocation(features: OLFeature[]): boolean {
  if (features.length <= 1) {
    return true;
  }
  const firstCoord = (features[0].getGeometry() as OLPoint).getCoordinates();
  for (let i = 1; i < features.length; i++) {
    const currentCoord = (features[i].getGeometry() as OLPoint).getCoordinates();
    if (firstCoord[0] !== currentCoord[0] || firstCoord[1] !== currentCoord[1]) {
      return false;
    }
  }
  return true;
}

document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("popup")! as HTMLDivElement;
  const content = document.getElementById("popup-content")! as HTMLDivElement;
  const closer = document.getElementById("popup-closer")! as HTMLDivElement;

  const overlay = new Overlay({
    element: container,
    autoPan: {
      animation: {
        duration: 250
      }
    }
  });

  closer.addEventListener("click", function () {
    overlay.setPosition(undefined);
    closer.blur();
    return false;
  });

  const map = new Map({
    layers: [
      new TileLayer({
        preload: Infinity,
        source: new OSM({})
      }),
      clusters,
      spiderfyLayer
    ],
    overlays: [overlay],
    target: "map",
    view: view
  });

  filterInput?.addEventListener("input", () => {
    updateFilter();
  });

  invert?.addEventListener("change", () => {
    updateFilter();
  });

  map.on("click", function (evt: MapBrowserEvent) {
    const pixel = evt.pixel;
    let handledClick = false;

    map.forEachFeatureAtPixel(
      pixel,
      function (feature: OLFeature, layer) {
        if (layer === spiderfyLayer) {
          if (feature.getGeometry() instanceof OLPoint && feature.get("originalFeature")) {
            displayFeatureInfo(feature.get("originalFeature"));
            handledClick = true;
            return true;
          }
        }
        return false;
      },
      {
        layerFilter: (layer) => layer === spiderfyLayer
      }
    );

    if (handledClick) {
      return;
    }

    map.forEachFeatureAtPixel(
      pixel,
      function (feature: OLFeature, layer) {
        if (layer === clusters) {
          const clusterFeatures = feature.get("features");
          const clusterCenter = (feature.getGeometry() as OLPoint).getCoordinates();

          const isClickedClusterCurrentlySpiderfied =
            currentClusterCenter &&
            clusterCenter[0] === currentClusterCenter[0] &&
            clusterCenter[1] === currentClusterCenter[1] &&
            currentSpiderfyFeatures.length > 0;

          if (isClickedClusterCurrentlySpiderfied) {
            spiderfyLayer.getSource()!.clear();
            currentSpiderfyFeatures = [];
            currentClusterCenter = undefined;
            overlay.setPosition(undefined);
            handledClick = true;
            return true;
          }

          if (clusterFeatures.length > 1) {
            const allAtSameLocation = areAllFeaturesAtSameLocation(clusterFeatures);

            if (allAtSameLocation) {
              spiderfyLayer.getSource()!.clear();
              currentSpiderfyFeatures = [];
              currentClusterCenter = undefined;
              overlay.setPosition(undefined);
              spiderfy(clusterFeatures, clusterCenter);
              handledClick = true;
              return true;
            } else {
              const currentZoom = view.getZoom() || 0;
              const targetZoom = Math.min(view.getMaxZoom(), currentZoom + 2);

              spiderfyLayer.getSource()!.clear();
              currentSpiderfyFeatures = [];
              currentClusterCenter = undefined;

              view.animate(
                {
                  zoom: targetZoom,
                  center: clusterCenter,
                  duration: 500
                },
                () => {
                  const newExtent = feature.getGeometry()!.getExtent();
                  const featuresInNewExtent = clusterSource.getFeaturesInExtent(newExtent);
                  const clustersStillPresentInNewExtent = featuresInNewExtent.filter(
                    (f) => f.get("features") && f.get("features").length > 1
                  );

                  const originalFeaturesCount = clusterFeatures.length;
                  const originalSourceFeaturesInNewExtent = vectorSource
                    .getFeaturesInExtent(newExtent)
                    .filter((f) => f.getGeometry() instanceof OLPoint);

                  if (
                    clustersStillPresentInNewExtent.length <= 1 &&
                    originalSourceFeaturesInNewExtent.length >= originalFeaturesCount * 0.9
                  ) {
                    spiderfy(clusterFeatures, clusterCenter);
                  } else {
                    spiderfyLayer.getSource()!.clear();
                    currentSpiderfyFeatures = [];
                    currentClusterCenter = undefined;
                    overlay.setPosition(undefined);
                  }
                }
              );
              handledClick = true;
              return true;
            }
          } else {
            displayFeatureInfo(clusterFeatures[0]);
            spiderfyLayer.getSource()!.clear();
            currentSpiderfyFeatures = [];
            currentClusterCenter = undefined;
            handledClick = true;
            return true;
          }
        }
        return false;
      },
      {
        layerFilter: (layer) => layer === clusters
      }
    );

    if (!handledClick) {
      spiderfyLayer.getSource()!.clear();
      currentSpiderfyFeatures = [];
      currentClusterCenter = undefined;
      overlay.setPosition(undefined);
    }
  });

  map.on("moveend", function () {
    if (currentSpiderfyFeatures.length > 0 && currentClusterCenter) {
      const zoom = view.getZoom();
      const currentCenter = view.getCenter();

      const distanceThreshold = 100000;
      const dist =
        currentCenter && currentClusterCenter
          ? Math.sqrt(Math.pow(currentCenter[0] - currentClusterCenter[0], 2) + Math.pow(currentCenter[1] - currentClusterCenter[1], 2))
          : 0;

      const spiderfyClearZoomThreshold = 8;

      if ((zoom && zoom < spiderfyClearZoomThreshold) || dist > distanceThreshold) {
        spiderfyLayer.getSource()!.clear();
        currentSpiderfyFeatures = [];
        currentClusterCenter = undefined;
      }
    }
  });

  function spiderfy(features: OLFeature[], center: Coordinate) {
    spiderfyLayer.getSource()!.clear();

    currentSpiderfyFeatures = features;
    currentClusterCenter = center;

    const numFeatures = features.length;
    const radius = 50;
    const angleStep = (2 * Math.PI) / numFeatures;

    features.forEach((feature, index) => {
      const angle = index * angleStep;
      const offsetX = radius * Math.sin(angle);
      const offsetY = radius * Math.cos(angle);

      const resolution = map.getView().getResolution() || 1;
      const spiderfyCoord: Coordinate = [center[0] + offsetX * resolution, center[1] + offsetY * resolution];

      const spiderfyPoint = new OLFeature({
        geometry: new OLPoint(spiderfyCoord),
        originalFeature: feature
      });
      spiderfyLayer.getSource()!.addFeature(spiderfyPoint);

      const line = new OLFeature({
        geometry: new LineString([center, spiderfyCoord]),
        isSpiderfyLine: true
      });
      spiderfyLayer.getSource()!.addFeature(line);
    });
  }

  function displayFeatureInfo(feature: OLFeature) {
    const originalFeature = feature.get("originalFeature") || feature;

    const geometry = originalFeature.getGeometry();
    if (geometry && geometry instanceof OLPoint) {
      const coord: Coordinate | undefined = geometry.getCoordinates();

      let text = `<h3>${originalFeature.get("title") || "No Title"}</h3>`;
      let preview = "";
      if (originalFeature.get("thumb")) {
        preview = `<img class="thumb" src="${originalFeature.get("thumb")}"></img>`;
      }
      text += `<div class="popup-body">${preview}${originalFeature.get("description") || "No description available"}<br><a target="_blank" href="${originalFeature.get("url") || "#"}">Sammlungsportal</a></div>`;

      content.innerHTML = text;
      overlay.setPosition(coord);
    }
  }

  function getRelated(geojson: FeatureCollection<GeoJSONPoint>): FeatureCollection {
    let relatedFeatures: Feature[] = [];
    geojson.features.forEach((feature) => {
      if ("related" in feature.properties!) {
        const geometry = feature.geometry;
        feature.properties.related.forEach((related: string) => {
          if (related.startsWith("http")) {
            filteredGeojson.features
              .filter((f) => f.properties?.url === related)
              .forEach((f) => {
                let relatedGeometry: Geometry;
                let properties: GeoJsonProperties = {};
                const fg = feature.geometry as GeoJSONPoint;
                if (geometry === null) {
                  return;
                }
                if (JSON.stringify(fg) !== JSON.stringify(geometry)) {
                  relatedGeometry = {
                    type: "LineString",
                    coordinates: [geometry.coordinates, fg.coordinates]
                  } as GeoJSONLineString;
                } else {
                  relatedGeometry = {
                    type: "Point",
                    coordinates: geometry.coordinates
                  } as GeoJSONPoint;
                }
                relatedFeatures.push({
                  type: "Feature",
                  geometry: relatedGeometry,
                  properties: properties
                });
              });
          }
        });
      }
    });
    return {
      type: "FeatureCollection",
      features: relatedFeatures
    };
  }

  cloud(filteredGeojson);

  const related = getRelated(filteredGeojson as FeatureCollection<GeoJSONPoint>);
  console.log(related.features.filter((f) => f.geometry.type === "LineString"));
});
