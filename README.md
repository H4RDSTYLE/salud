# Observatorio de Salud de Castilla y León

Mapa e indicadores sanitarios por Zona Básica de Salud a partir de datos abiertos de la Junta de Castilla y León: población de referencia, mortalidad, urgencias hospitalarias, prevalencias, gasto y recursos. Web 100 % estática (HTML + JS + ECharts/Leaflet, sin servidor) que sirve JSON preprocesados desde `data/`.

- **Acceso:** https://h4rdstyle.github.io/salud/

## Qué ofrece

- **Mapa interactivo de Zonas Básicas de Salud:** población de referencia, urgencias atendidas (2024/25) y fallecimientos (2021 → 2026), con filtro por provincia y ficha de detalle de cada zona.
- **Presión asistencial:** urgencias hospitalarias por mes y por hospital (campaña 2024/25), distribución por edad y por nivel de triaje.
- **Mortalidad:** serie mensual de fallecimientos en CyL, indicadores por provincia y centro de salud.
- **Población:** pirámide de población de referencia 2026 por edad y sexo.
- **Prevalencias:** pacientes activos registrados por patología (hipertensión, diabetes, dislipemia, ic, EPOC y crónicos complejos) y comparativa por provincia.
- **Gasto y recursos:** gasto sanitario ejecutado por año según el presupuesto de la Junta y personal en instituciones sanitarias.
- **Conclusiones y tablas:** indicadores por habitante con columnas ordenables y descarga CSV.

## Datos utilizados

Fuente de todos los datos: **Portal y API de análisis de datos abiertos de Castilla y León** (`datosabiertos.jcyl.es` · `analisis.datosabiertos.jcyl.es`), complementados con fuentes SACYL y estadísticas de personal citadas en la aplicación.

- Mapa de Zonas Básicas de Salud (GeoJSON) y población de referencia por ZBS.
- Población por edad, sexo y provincia (Registro de municipios de CyL).
- Tasa de mortalidad por centro de salud y serie mensual de defunciones.
- Urgencias hospitalarias atendidas (hospital, provincia, triaje, edad y mes).
- Centros de salud por municipio y prevalencias por patología.
- Presupuesto de gastos (sección Sanidad) y efectivos de la Gerencia Regional de Salud.

## Cómo ejecutarlo

```bash
# 1) Regenerar los datos (opcional; ya están en data/)
python scripts/fetch_data.py

# 2) Servir la web (los fetch de JSON necesitan un servidor local, no file://)
python -m http.server 8890
# Abrir  http://127.0.0.1:8890/
```

## Estructura

```
salud/
  index.html        interfaz (mapa, gráficos y tablas)
  css/ js/          estilos y lógica
  lib/              librerías locales (ECharts, Leaflet)
  data/             JSON preprocesados (GeoJSON de zonas, indicadores, presupuesto…)
  scripts/          fetch_data.py (descarga y agrega)
```

## Metodología y notas

- **Población de referencia:** ciudadanos con derecho a asistencia sanitaria (tarjetas sanitarias individuales) registrados en el periodo.
- **Urgencias:** episodios atendidos entre octubre de 2024 y septiembre de 2025.
- **Mortalidad:** fallecidos consolidados por centro de salud y fecha del registro de tasas de mortalidad.
- **Prevalencias:** pacientes con proceso activo en el momento de la descarga (muestra publicada), no tasas poblacionales.

## Licencia

Este proyecto está licenciado bajo **[Creative Commons Atribución 4.0 Internacional (CC BY 4.0)](LICENSE)**. Los datos reutilizados conservan la licencia de su fuente (CC BY 4.0); la aplicación la cita en todo momento.