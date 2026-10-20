# Dev-only: copy the plugin files from this clone into the local XAMPP test site.
# The XAMPP copy is a deploy/test copy, never a source of truth.
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $PSScriptRoot
$dst = 'C:\xampp\htdocs\wordpress\wp-content\plugins\greek-vat-invoices-for-woocommerce'

if (-not (Test-Path $dst)) { throw "XAMPP plugin folder not found: $dst" }

Copy-Item (Join-Path $src 'greek-vat-invoices-for-woocommerce.php') $dst -Force
Copy-Item (Join-Path $src 'includes\*.php') (Join-Path $dst 'includes') -Force
Copy-Item (Join-Path $src 'assets\css\admin.css') (Join-Path $dst 'assets\css') -Force

Write-Host "Deployed to $dst"
