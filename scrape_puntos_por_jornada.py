import logging
import re
import sys
import time
from io import StringIO
from typing import List, Optional

import numpy as np
import pandas as pd
import requests
from requests import Response

from selenium import webdriver
from selenium.common.exceptions import WebDriverException, TimeoutException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.firefox import GeckoDriverManager


URL = "https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado"
MAX_REQUEST_ATTEMPTS = 3
REQUEST_TIMEOUT = 15
SELENIUM_WAIT_SECONDS = 15


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def fetch_with_requests(url: str) -> Optional[str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }

    for attempt in range(1, MAX_REQUEST_ATTEMPTS + 1):
        try:
            response: Response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            encoding = response.apparent_encoding or response.encoding or "utf-8"
            response.encoding = encoding
            logging.info("Contenido obtenido con requests en el intento %s", attempt)
            return response.text
        except requests.RequestException as exc:
            logging.warning(
                "Falló la descarga con requests (intento %s/%s): %s",
                attempt,
                MAX_REQUEST_ATTEMPTS,
                exc,
            )
            if attempt < MAX_REQUEST_ATTEMPTS:
                sleep_seconds = 2 ** attempt
                time.sleep(sleep_seconds)
    logging.error("No se pudo obtener el contenido con requests tras %s intentos", MAX_REQUEST_ATTEMPTS)
    return None


def _build_chrome_driver() -> webdriver.Chrome:
    options = ChromeOptions()
    for arg in [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
    ]:
        options.add_argument(arg)
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    driver = webdriver.Chrome(ChromeDriverManager().install(), options=options)
    return driver


def _build_firefox_driver() -> webdriver.Firefox:
    options = FirefoxOptions()
    options.add_argument("-headless")
    driver = webdriver.Firefox(executable_path=GeckoDriverManager().install(), options=options)
    return driver


def fetch_with_selenium(url: str) -> str:
    last_exc: Optional[Exception] = None
    for builder, name in ((
        _build_chrome_driver,
        "Chrome",
    ), (
        _build_firefox_driver,
        "Firefox",
    )):
        driver = None
        try:
            driver = builder()
            logging.info("Renderizando la página con Selenium usando %s", name)
            driver.get(url)
            WebDriverWait(driver, SELENIUM_WAIT_SECONDS).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "table"))
            )
            # Pausa breve para asegurar que la tabla se ha terminado de renderizar.
            time.sleep(1)
            html = driver.page_source
            logging.info("Contenido obtenido con Selenium (%s)", name)
            return html
        except (WebDriverException, TimeoutException) as exc:
            last_exc = exc
            logging.warning("Fallo al usar Selenium con %s: %s", name, exc)
        finally:
            if driver is not None:
                driver.quit()
    raise RuntimeError(f"No se pudo renderizar la página con Selenium: {last_exc}")


def pick_players_table(frames: List[pd.DataFrame]) -> Optional[pd.DataFrame]:
    best_candidate: Optional[pd.DataFrame] = None
    best_score: tuple = (-1, -1, -1)

    for idx, frame in enumerate(frames):
        columns = [str(col).strip() for col in frame.columns]
        lowered = [col.lower() for col in columns]

        has_player = any(re.search(r"jugador|nombre|player", col) for col in lowered)
        has_team = any(re.search(r"equipo|club", col) for col in lowered)
        has_position = any(
            re.search(r"pos|posición|demarcación", col)
            or re.fullmatch(r"por|def|med|del", col)
            for col in lowered
        )
        point_cols = [
            col
            for col in columns
            if re.search(r"puntos|pts|jornada", col.lower())
            or re.match(r"j\s*-?\s*\d+", col.lower())
        ]
        score = (
            int(has_player) + int(has_team) + int(has_position) + (2 if point_cols else 0),
            len(point_cols),
            len(frame),
        )
        logging.debug(
            "Tabla %s: columnas=%s, puntuación=%s",
            idx,
            columns,
            score,
        )
        if not has_player or not point_cols:
            continue
        if score > best_score:
            best_candidate = frame
            best_score = score

    if best_candidate is not None:
        logging.info(
            "Tabla seleccionada con puntuación %s (filas=%s)",
            best_score,
            best_candidate.shape[0],
        )
    else:
        logging.warning("No se encontró una tabla que cumpla los criterios de selección")
    return best_candidate


def _normalize_column_name(name: str) -> str:
    original = str(name).strip()
    lower = original.lower()
    lower = re.sub(r"\s+", " ", lower)

    jornada_match = re.match(r"j\s*-?\s*(\d+)", lower)
    if jornada_match:
        return f"J{int(jornada_match.group(1))}"

    mappings = {
        r"jugador|nombre|player": "Jugador",
        r"equipo|club": "Equipo",
        r"posici[óo]n|pos\.?:|pos$|demarcaci[óo]n|dem": "Posición",
        r"valor|precio": "Valor (€)",
        r"variaci[óo]n|subida|baja|cambio|%": "Variación (%)",
        r"jornada|matchday|gw|round": "Jornada",
        r"puntos|pts|score": "Puntos",
    }

    for pattern, target in mappings.items():
        if re.search(pattern, lower):
            return target

    return original


def _ensure_unique_columns(columns: List[str]) -> List[str]:
    seen = {}
    result = []
    for col in columns:
        if col not in seen:
            seen[col] = 0
            result.append(col)
        else:
            seen[col] += 1
            result.append(f"{col}_{seen[col]}")
    return result


def _extract_team_from_text(text: str) -> tuple:
    if not isinstance(text, str):
        return None, None
    # Patrones comunes: "Jugador (Equipo)", "Jugador - Equipo", "Equipo · Pos"
    team = None
    position = None

    # Paréntesis con equipo
    match = re.search(r"\(([^()]+)\)", text)
    if match:
        team_candidate = match.group(1).strip()
        if team_candidate:
            team = team_candidate

    # Separadores como "-" o "·"
    parts = re.split(r"\s*[·\-]\s*", text)
    if len(parts) >= 2:
        # Considerar último segmento como posible equipo
        possible_team = parts[-1].strip()
        if team is None and len(possible_team) > 1:
            team = possible_team
        # Considerar penúltimo segmento como posible posición si coincide con abreviatura
        possible_position = parts[-2].strip().upper()
        if possible_position in {"POR", "DEF", "MED", "DEL"}:
            position = possible_position

    return team, position


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    normalized_columns = [_normalize_column_name(col) for col in df.columns]
    normalized_columns = _ensure_unique_columns(normalized_columns)
    df.columns = normalized_columns

    if "Jugador" in df.columns:
        equipos = []
        posiciones = []
        for value in df["Jugador"]:
            team, pos = _extract_team_from_text(value)
            equipos.append(team)
            posiciones.append(pos)
        equipos_series = pd.Series(equipos, index=df.index)
        posiciones_series = pd.Series(posiciones, index=df.index)
        if "Equipo" not in df.columns:
            df["Equipo"] = equipos_series
        else:
            df["Equipo"] = df["Equipo"].fillna(equipos_series)
        if "Posición" not in df.columns:
            df["Posición"] = posiciones_series
        else:
            df["Posición"] = df["Posición"].fillna(posiciones_series)

    # Asegurar que las columnas básicas existen aunque sea vacías
    for required in ["Equipo", "Posición"]:
        if required not in df.columns:
            df[required] = np.nan

    def _clean_numeric(series: pd.Series, remove_percent: bool = False) -> pd.Series:
        cleaned = (
            series.astype(str)
            .str.replace(r"\s+", "", regex=True)
            .str.replace("€", "", regex=False)
        )
        if remove_percent:
            cleaned = cleaned.str.replace("%", "", regex=False)
        cleaned = cleaned.str.replace(r"\.(?=\d{3}(?:\D|$))", "", regex=True)
        cleaned = cleaned.str.replace(",", ".", regex=False)
        cleaned = cleaned.str.replace(r"[^0-9.+-]", "", regex=True)
        return pd.to_numeric(cleaned, errors="coerce")

    if "Valor (€)" in df.columns:
        df["Valor (€)"] = _clean_numeric(df["Valor (€)"])

    if "Variación (%)" in df.columns:
        df["Variación (%)"] = _clean_numeric(df["Variación (%)"], remove_percent=True)

    return df


def to_long_format(df: pd.DataFrame) -> pd.DataFrame:
    punto_cols = [col for col in df.columns if re.fullmatch(r"J\d+", str(col))]

    if punto_cols:
        punto_cols = sorted(punto_cols, key=lambda x: int(re.findall(r"\d+", x)[0]))
        id_columns = [col for col in ["Jugador", "Equipo", "Posición", "Valor (€)", "Variación (%)"] if col in df.columns]
        df_long = df.melt(
            id_vars=id_columns,
            value_vars=punto_cols,
            var_name="Jornada",
            value_name="Puntos",
        )
        df_long["Jornada"] = df_long["Jornada"].astype(str).str.extract(r"(\d+)").astype(float).astype("Int64")
    else:
        df_long = df.copy()
        jornada_candidates = [col for col in df_long.columns if col.startswith("Jornada") or _normalize_column_name(col) == "Jornada"]
        puntos_candidates = [col for col in df_long.columns if col.startswith("Puntos") or _normalize_column_name(col) == "Puntos"]
        if not jornada_candidates or not puntos_candidates:
            raise ValueError("La tabla no contiene columnas de jornada identificables")
        jornada_col = jornada_candidates[0]
        puntos_col = puntos_candidates[0]
        df_long = df_long.rename(columns={jornada_col: "Jornada", puntos_col: "Puntos"})

    df_long["Puntos"] = pd.to_numeric(df_long["Puntos"], errors="coerce")
    df_long = df_long.dropna(subset=["Jornada", "Puntos"])
    df_long["Jornada"] = df_long["Jornada"].astype(int)
    df_long["Puntos"] = df_long["Puntos"].astype(float)
    return df_long


def build_pivot(df_long: pd.DataFrame) -> pd.DataFrame:
    pivot = pd.pivot_table(
        df_long,
        index="Jugador",
        columns="Jornada",
        values="Puntos",
        aggfunc="sum",
    )
    pivot = pivot.sort_index(axis=0)
    pivot = pivot.reindex(sorted(pivot.columns), axis=1)
    return pivot


def main() -> None:
    logging.info("Iniciando extracción de puntos por jornada")
    html = fetch_with_requests(URL)

    tables: List[pd.DataFrame] = []
    if html:
        try:
            tables = pd.read_html(StringIO(html))
            logging.info("Se encontraron %s tablas con requests", len(tables))
        except ValueError:
            logging.warning("No se pudieron parsear tablas con requests")

    if not tables:
        logging.info("Intentando obtener la página con Selenium por contenido dinámico")
        try:
            html = fetch_with_selenium(URL)
            tables = pd.read_html(StringIO(html))
            logging.info("Se encontraron %s tablas tras renderizar con Selenium", len(tables))
        except Exception as exc:
            logging.error("No se pudo obtener contenido con Selenium: %s", exc)
            print("No se pudo extraer la tabla de jugadores. Abortando.")
            sys.exit(1)

    candidate = pick_players_table(tables)
    if candidate is None:
        print("No se encontró una tabla principal de jugadores.")
        sys.exit(1)

    normalized = normalize_columns(candidate)

    try:
        df_long = to_long_format(normalized)
    except ValueError as exc:
        logging.error("Error al transformar la tabla a formato largo: %s", exc)
        print("No se pudo transformar la tabla a formato largo. Abortando.")
        sys.exit(1)

    summary_columns = ["Jugador", "Jornada"]
    aggregated = (
        df_long.groupby(summary_columns, as_index=False)["Puntos"].sum()
    )

    if "Equipo" in df_long.columns:
        equipos = df_long[["Jugador", "Equipo"]].dropna().drop_duplicates(subset=["Jugador"])
        aggregated = aggregated.merge(equipos, on="Jugador", how="left")
    if "Posición" in df_long.columns:
        posiciones = df_long[["Jugador", "Posición"]].dropna().drop_duplicates(subset=["Jugador"])
        aggregated = aggregated.merge(posiciones, on="Jugador", how="left")

    for required in ["Equipo", "Posición"]:
        if required not in aggregated.columns:
            aggregated[required] = np.nan

    aggregated = aggregated[[
        col for col in ["Jugador", "Equipo", "Posición", "Jornada", "Puntos"] if col in aggregated.columns
    ]]

    aggregated.to_csv("puntos_por_jornada_largo.csv", index=False)
    logging.info("Archivo puntos_por_jornada_largo.csv generado (%s filas)", len(aggregated))

    pivot = build_pivot(aggregated)
    pivot.to_csv("puntos_por_jornada_pivot.csv")
    logging.info("Archivo puntos_por_jornada_pivot.csv generado (jugadores=%s)", pivot.shape[0])

    print(pivot.head(10))


if __name__ == "__main__":
    main()
