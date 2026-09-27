# Exoplanet mass–period data

Retrieved on **2026-09-27** for the STATS 401 individual project. The committed files are a reproducible snapshot; NASA’s live archive changes as new planets and measurements are added.

## Files

- `exoplanets_mass_period.csv` — 2,819 confirmed planets from the NASA Exoplanet Archive Planetary Systems (`ps`) table. Every row uses the archive’s default parameter set and has both an orbital period and best-mass value.
- `solar_system_planets.csv` — eight Solar System planets derived from JPL’s *Planetary Physical Parameters* table.
- `jpl_planetary_physical_parameters.html` — the downloaded JPL source snapshot used for the Solar System conversion.
- `download_data.ps1` — refreshes the NASA/JPL source files and rebuilds `solar_system_planets.csv`.
- `../assets/nasa_exoplanet_mass_period.png` — local copy of NASA’s original visualization, whose printed date is 2026-09-25.

## NASA Exoplanet Archive query

Endpoint: <https://exoplanetarchive.ipac.caltech.edu/TAP/sync>

Table: `ps` (Planetary Systems)

```sql
SELECT
  pl_name, hostname, pl_letter, discoverymethod, disc_year,
  disc_facility, disc_telescope, disc_instrument,
  pl_orbper, pl_orbpererr1, pl_orbpererr2,
  pl_bmassj, pl_bmassjerr1, pl_bmassjerr2,
  pl_bmasse, pl_bmasseerr1, pl_bmasseerr2, pl_bmassprov,
  sy_dist, st_spectype, rowupdate, pl_pubdate
FROM ps
WHERE default_flag = 1
  AND pl_orbper IS NOT NULL
  AND pl_bmassj IS NOT NULL
ORDER BY pl_name
```

The filter matches the archive’s description of its pre-generated plots: points are shown only when all parameters required by the plot have measured values. The original interactive chart uses `pl_orbper` for x, `pl_bmassj` for y, and `discoverymethod` for the categorical encoding.

## Field dictionary

| Field | Use |
|---|---|
| `pl_name`, `hostname`, `pl_letter` | Planet identity |
| `pl_orbper` | Orbital period in days; x position |
| `pl_orbpererr1`, `pl_orbpererr2` | Upper/lower orbital-period uncertainty |
| `pl_bmassj` | Best planet mass in Jupiter masses; y position |
| `pl_bmassjerr1`, `pl_bmassjerr2` | Upper/lower best-mass uncertainty |
| `pl_bmasse` and errors | Same best mass in Earth masses |
| `pl_bmassprov` | Provenance/type of best mass, such as `Mass` or `Msini` |
| `discoverymethod` | Discovery-method category |
| `disc_year` | Discovery year for optional temporal filtering |
| `disc_facility`, `disc_telescope`, `disc_instrument` | Discovery context for details on demand |
| `sy_dist` | System distance in parsecs |
| `st_spectype` | Host-star spectral type |
| `rowupdate`, `pl_pubdate` | Archive/publication freshness |

## Solar System conversion

Source: <https://ssd.jpl.nasa.gov/planets/phys_par.html>

JPL reports mass in 10²⁴ kg and sidereal orbital period in years. The project converts values as follows:

```text
orbital_period_days = sidereal_orbital_period_years × 365.25
mass_jupiter = mass_1e24_kg ÷ 1898.125
```

Only the eight planets are included, matching the original NASA plot. Pluto is not included because JPL classifies it as a dwarf planet.

## Sources and citation

- NASA Exoplanet Archive, [Pre-generated Exoplanet Plots](https://exoplanetarchive.ipac.caltech.edu/exoplanetplots/).
- NASA Exoplanet Archive, [Planetary Systems Table](https://doi.org/10.26133/NEA12), DOI `10.26133/NEA12`.
- NASA Exoplanet Archive, [TAP User Guide](https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html).
- NASA/JPL Solar System Dynamics, [Planetary Physical Parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html).

When publishing the final page/report, acknowledge the NASA Exoplanet Archive and cite the Planetary Systems dataset DOI above.
