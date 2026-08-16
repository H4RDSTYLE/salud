# -*- coding: utf-8 -*-
"""
Observatorio de Salud CyL - preprocesado de datos.

Descarga y agrega los conjuntos de datos del Portal de Datos Abiertos
de la Junta de Castilla y León (API Opendatasoft) y genera los ficheros
JSON que consume la aplicación web estática (carpeta ../data).

Ejecutar:  python fetch_data.py
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

BASE = "https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def http_get(url, timeout=120):
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(4 * (attempt + 1))
                continue
            raise
        except Exception as e:
            last = e
            time.sleep(4 * (attempt + 1))
    raise last


def records(dataset, select=None, group_by=None, where=None, limit=100, order_by=None):
    if limit > 100:
        limit = 100
    params = {"limit": str(limit)}
    if select:
        params["select"] = select
    if group_by:
        params["group_by"] = group_by
    if where:
        params["where"] = where
    if order_by:
        params["order_by"] = order_by
    url = f"{BASE}/{urllib.parse.quote(dataset)}/records?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    out = list(data.get("results", []))
    total = data.get("total_count", len(out))
    offset = limit
    if group_by:
        # En agrupaciones Opendatasoft no devuelve el total real: iterar hasta página vacía.
        while offset <= 8800:
            url = f"{BASE}/{urllib.parse.quote(dataset)}/records?"
            url += urllib.parse.urlencode({**params, "offset": str(offset)})
            data = json.loads(http_get(url))
            chunk = data.get("results", [])
            if not chunk:
                break
            out.extend(chunk)
            offset += limit
    else:
        while offset < total and offset <= 50000:
            url = f"{BASE}/{urllib.parse.quote(dataset)}/records?"
            url += urllib.parse.urlencode({**params, "offset": str(offset)})
            data = json.loads(http_get(url))
            chunk = data.get("results", [])
            if not chunk:
                break
            out.extend(chunk)
            offset += limit
    return out


def count_in(dataset, where):
    """Devuelve count(*) de un dataset aplicando un filtro (sin group_by)."""
    params = {"select": "count(*) as n", "where": where}
    url = f"{BASE}/{urllib.parse.quote(dataset)}/records?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    res = data.get("results") or []
    return int(res[0]["n"]) if res else 0


def month_ranges(start_year, start_month, end_year, end_month):
    """Genera pares (inicio_fin) de 'YYYY-MM-01' para cada mes del rango."""
    out = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        start = date(y, m, 1)
        if m == 12:
            nxt = date(y + 1, 1, 1)
        else:
            nxt = date(y, m + 1, 1)
        out.append((start.isoformat(), nxt.isoformat()))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def export_geojson(dataset, params=None):
    url = f"{BASE}/{urllib.parse.quote(dataset)}/exports/geojson"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, timeout=180))


def save(name, obj):
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {name}  ({os.path.getsize(path) / 1024:.0f} KB)")


def decimate_ring(ring, every=2, min_size=400):
    """Reduce el número de vértices de un anillo conservando la forma."""
    if len(ring) <= min_size:
        return ring
    kept = ring[::every]
    if kept[-1] != ring[-1]:
        kept.append(ring[-1])
    return kept


def simplify_geojson(gj, decimal=4, every=2):
    """Reduce precisión y vértices de la geometría para aligerar el fichero."""
    def walk(v):
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, float):
            return round(v, decimal)
        return v

    def decimate(geom):
        if not geom:
            return geom
        if geom["type"] == "MultiPolygon":
            polys = []
            for poly in geom["coordinates"]:
                poly2 = []
                for r, ring in enumerate(poly):
                    poly2.append(decimate_ring(ring, every) if r == 0 else ring)
                polys.append(poly2)
            geom["coordinates"] = polys
        elif geom["type"] == "Polygon":
            geom["coordinates"] = [
                decimate_ring(r, every) if i == 0 else r
                for i, r in enumerate(geom["coordinates"])
            ]
        return geom

    for feat in gj.get("features", []):
        feat["properties"] = {k: v for k, v in feat.get("properties", {}).items()
                              if k in ("codigo_zona", "d_zbs", "provincia", "num_mun")}
        feat["geometry"] = decimate(feat.get("geometry"))
        feat["geometry"] = walk(feat["geometry"])
    return gj


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    print("== Mapa de Zonas Básicas de Salud ==")
    zbs = export_geojson("mapas-de-areas-de-salud-de-castilla-y-leon",
                         {"select": "geo_shape,codigo_zona,d_zbs,provincia,num_mun"})
    zbs = simplify_geojson(zbs, 4, 2)
    save("zbs_map.json", zbs)

    print("== Población de referencia (2026) ==")
    poblacion_zbs = records(
        "poblacion-de-referencia-2026",
        select="zona_b_sica_de_salud_cudigo as zbs_code,zona_b_sica_de_salud as zbs,provincia,count(*) as n",
        group_by="zona_b_sica_de_salud_cudigo,zona_b_sica_de_salud,provincia",
    )
    save("poblacion_zbs.json", poblacion_zbs)
    time.sleep(0.5)

    poblacion_prov = records(
        "poblacion-de-referencia-2026",
        select="provincia,count(*) as n",
        group_by="provincia",
    )
    save("poblacion_prov.json", poblacion_prov)
    time.sleep(0.5)

    edades = records(
        "poblacion-de-referencia-2026",
        select="edad,sexo,count(*) as n",
        group_by="edad,sexo",
    )
    save("poblacion_edad.json", edades)
    time.sleep(0.5)

    print("== Mortalidad ==")
    mort_prov = records(
        "tasa-mortalidad-por-centros-de-salud",
        select="provincia,sum(fallecidos) as fallecidos,count(*) as registros,avg(tasax100) as tasa",
        group_by="provincia",
        where="fecha is not null",
        limit=100,
    )
    save("mortalidad_prov.json", mort_prov)
    time.sleep(0.5)

    mort_centro = records(
        "tasa-mortalidad-por-centros-de-salud",
        select="centro,provincia,municipio,gerencia,sum(fallecidos) as fallecidos,max(x_geo) as lon,max(y_geo) as lat",
        group_by="centro,provincia,municipio,gerencia",
        where="fecha >= '2025-01-01' and x_geo is not null",
        limit=2000,
    )
    save("mortalidad_centro.json", mort_centro)
    time.sleep(0.5)

    print("  serie mensual (2022 -> actualidad)")
    mort_ts = []
    for start, end in month_ranges(2022, 1, 2026, 8):
        where = f"fecha >= '{start}' and fecha < '{end}'"
        n = count_in("tasa-mortalidad-por-centros-de-salud", where)
        mort_ts.append({"mes": start, "fallecidos": n})
        time.sleep(0.15)
    save("mortalidad_ts.json", mort_ts)

    print("== Urgencias hospitalarias 2024/2025 ==")
    urg_prov = records(
        "urgencias-hospitalarias-atendidas",
        select="provincia,count(*) as n",
        group_by="provincia",
    )
    save("urgencias_prov.json", urg_prov)
    time.sleep(0.5)

    urg_hospital = records(
        "urgencias-hospitalarias-atendidas",
        select="hospital,provincia,count(*) as n",
        group_by="hospital,provincia",
    )
    save("urgencias_hospital.json", urg_hospital)
    time.sleep(0.5)

    urg_triaje = records(
        "urgencias-hospitalarias-atendidas",
        select="nivel_de_triaje,count(*) as n",
        group_by="nivel_de_triaje",
    )
    save("urgencias_triaje.json", urg_triaje)
    time.sleep(0.5)

    urg_edad = records(
        "urgencias-hospitalarias-atendidas",
        select="edad,count(*) as n",
        group_by="edad",
    )
    save("urgencias_edad.json", urg_edad)
    time.sleep(0.5)

    print("  serie mensual (2024-10 -> 2025-09)")
    urg_mes = []
    urg_hospital_mes = []
    for start, end in month_ranges(2024, 10, 2025, 9):
        where = f"fecha_de_atencion >= '{start}' and fecha_de_atencion < '{end}'"
        n = count_in("urgencias-hospitalarias-atendidas", where)
        urg_mes.append({"mes": start, "n": n})
        time.sleep(0.15)
        if n:
            by_h = records(
                "urgencias-hospitalarias-atendidas",
                select="hospital,count(*) as n",
                group_by="hospital",
                where=where,
            )
            urg_hospital_mes.append({"mes": start, "hospitales": by_h})
            time.sleep(0.15)
    save("urgencias_mes.json", urg_mes)
    save("urgencias_hospital_mes.json", urg_hospital_mes)

    print("== Centros de salud por municipio ==")
    centros = records(
        "centros-de-salud-municipios",
        select="nombre_gerencia,codigo_zona,nombre_zona,nombre_centro_salud,municipio",
        limit=10000,
    )
    save("centros_salud.json", centros)
    time.sleep(0.5)

    print("== Registro municipal (coordenadas y población) ==")
    municipios = records(
        "registro-de-municipios-de-castilla-y-leon",
        select="municipio,cod_ine,provincia,poblacion,longitud,latitud",
        limit=10000,
    )
    save("municipios.json", municipios)
    time.sleep(0.5)

    print("== Prevalencias (muestra de pacientes activos) ==")
    prev = {}
    for ds, key in [
        ("prevalencia-de-hta-2025", "hta"),
        ("prevalencia-de-diabetes-tipo-2-2025", "diabetes"),
        ("prevalencia-de-dislipemia-2025", "dislipemia"),
        ("prevalencia-de-insuficiencia-cardiaca-2025", "insuficiencia_cardiaca"),
        ("prevalencia-de-epoc-2025", "epoc"),
        ("prevalencia-de-pacientes-cronicos-complejos", "cronicos"),
    ]:
        r = records(ds, select="provincia,count(*) as n", group_by="provincia")
        prev[key] = r
        time.sleep(0.3)
    save("prevalencia.json", prev)

    print("== OK ==")


if __name__ == "__main__":
    main()