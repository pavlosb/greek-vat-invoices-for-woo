# Dev-only: copy the plugin files from this clone into a local test install.
# The copy is a deploy/test copy, never a source of truth.
#
#   .\tests\deploy-to-xampp.ps1
#       Default: refresh the existing plugin folder of the local XAMPP site
#       (C:\xampp\htdocs\wordpress): main file, includes\*.php and assets\css\admin.css.
#
#   .\tests\deploy-to-xampp.ps1 -Target C:\xampp\htdocs\other_site\wp-content\plugins\greek-vat-invoices-for-woocommerce
#       Any other install: full deploy into that plugin folder (created if missing):
#       main file, includes\*.php, the whole assets\ folder and languages\ when present.
param(
    [string]$Target = 'C:\xampp\htdocs\wordpress\wp-content\plugins\greek-vat-invoices-for-woocommerce'
)
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $PSScriptRoot
$dst = $Target
$fullDeploy = $PSBoundParameters.ContainsKey('Target')

if ($fullDeploy) {
    New-Item -ItemType Directory -Force (Join-Path $dst 'includes') | Out-Null
} elseif (-not (Test-Path $dst)) {
    throw "XAMPP plugin folder not found: $dst"
}

Copy-Item (Join-Path $src 'greek-vat-invoices-for-woocommerce.php') $dst -Force
Copy-Item (Join-Path $src 'includes\*.php') (Join-Path $dst 'includes') -Force

if ($fullDeploy) {
    # Whole assets folder (css + js) and the translations, so a fresh install is complete
    Copy-Item (Join-Path $src 'assets') $dst -Recurse -Force
    if (Test-Path (Join-Path $src 'languages')) {
        Copy-Item (Join-Path $src 'languages') $dst -Recurse -Force
    }
} else {
    Copy-Item (Join-Path $src 'assets\css\admin.css') (Join-Path $dst 'assets\css') -Force
}

Write-Host "Deployed to $dst"
