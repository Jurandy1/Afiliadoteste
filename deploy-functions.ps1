# Deploy das Cloud Functions Shopee (agregação alinhada ao painel Insights)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root "tools\node"
if (Test-Path $node) { $env:PATH = "$node;$env:PATH" }

Set-Location $root
Write-Host ">> Instalando dependencias das functions..."
Set-Location (Join-Path $root "functions")
npm install --silent
Set-Location $root

Write-Host ">> Verificando login Firebase..."
npx firebase projects:list --project projetoafiliado-9ff07 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host ">> Faca login no Firebase (abrira o navegador):"
  npx firebase login
}

Write-Host ">> Deploy das functions Shopee..."
npx firebase deploy `
  --only "functions:shopeeBackfillNow,functions:shopeeRecentDaysSync,functions:shopeeDailyReconcile,functions:shopeeIncrementalSync" `
  --project projetoafiliado-9ff07

Write-Host ">> Concluido. No dashboard, filtre maio/2026 e clique Aplicar para re-sincronizar."
