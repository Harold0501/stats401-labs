$ErrorActionPreference = 'Stop'

$dataDirectory = $PSScriptRoot
$projectDirectory = Split-Path -Parent $dataDirectory
$assetDirectory = Join-Path $projectDirectory 'assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null

$query = @'
select pl_name,hostname,pl_letter,discoverymethod,disc_year,disc_facility,disc_telescope,disc_instrument,pl_orbper,pl_orbpererr1,pl_orbpererr2,pl_bmassj,pl_bmassjerr1,pl_bmassjerr2,pl_bmasse,pl_bmasseerr1,pl_bmasseerr2,pl_bmassprov,sy_dist,st_spectype,rowupdate,pl_pubdate from ps where default_flag=1 and pl_orbper is not null and pl_bmassj is not null order by pl_name
'@.Trim()

$tapUrl = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=' +
    [uri]::EscapeDataString($query) + '&format=csv'

Invoke-WebRequest -UseBasicParsing -Uri $tapUrl `
    -OutFile (Join-Path $dataDirectory 'exoplanets_mass_period.csv')

$jplUrl = 'https://ssd.jpl.nasa.gov/planets/phys_par.html'
Invoke-WebRequest -UseBasicParsing -Uri $jplUrl `
    -OutFile (Join-Path $dataDirectory 'jpl_planetary_physical_parameters.html')

$originalPlotUrl = 'https://exoplanetarchive.ipac.caltech.edu/exoplanetplots/nea_scatter_PS_output_pl_orbper_pl_bmassj_pres.png'
Invoke-WebRequest -UseBasicParsing -Uri $originalPlotUrl `
    -OutFile (Join-Path $assetDirectory 'nasa_exoplanet_mass_period.png')

$jupiterMass = 1898.125
$planets = @(
    [pscustomobject]@{ name = 'Mercury'; label = 'Me'; period_years = 0.2408467; mass = 0.330103 }
    [pscustomobject]@{ name = 'Venus'; label = 'V'; period_years = 0.61519726; mass = 4.86731 }
    [pscustomobject]@{ name = 'Earth'; label = 'E'; period_years = 1.0000174; mass = 5.97217 }
    [pscustomobject]@{ name = 'Mars'; label = 'Ma'; period_years = 1.8808476; mass = 0.641691 }
    [pscustomobject]@{ name = 'Jupiter'; label = 'J'; period_years = 11.862615; mass = 1898.125 }
    [pscustomobject]@{ name = 'Saturn'; label = 'S'; period_years = 29.447498; mass = 568.317 }
    [pscustomobject]@{ name = 'Uranus'; label = 'U'; period_years = 84.016846; mass = 86.8099 }
    [pscustomobject]@{ name = 'Neptune'; label = 'N'; period_years = 164.79132; mass = 102.4092 }
)

$planets | ForEach-Object {
    [pscustomobject]@{
        name = $_.name
        label = $_.label
        orbital_period_days = [math]::Round($_.period_years * 365.25, 6)
        mass_1e24_kg = $_.mass
        mass_jupiter = [math]::Round($_.mass / $jupiterMass, 12)
        source = 'JPL Planetary Physical Parameters'
    }
} | Export-Csv -NoTypeInformation -Encoding utf8 `
    -Path (Join-Path $dataDirectory 'solar_system_planets.csv')

Write-Host 'Downloaded the exoplanet snapshot, JPL source, original plot, and rebuilt the Solar System CSV.'
