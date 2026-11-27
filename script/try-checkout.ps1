# Runs a test purchase against a deployed Ledgerline: opens an account, starts a Stripe
# Checkout, waits while you pay on Stripe's page, then shows the credited balance.
#
#   powershell -File script\try-checkout.ps1 -BaseUrl https://your-service.onrender.com
#
# Reads LEDGERLINE_API_KEY from .env in the repository root. Use Stripe test mode only.
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [int]$Credits = 250,
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env")
)
$ErrorActionPreference = "Stop"

$line = Get-Content $EnvFile | Where-Object { $_ -match '^LEDGERLINE_API_KEY=' } | Select-Object -First 1
if (-not $line) { throw "LEDGERLINE_API_KEY not found in $EnvFile" }
$headers = @{ Authorization = "Bearer " + $line.Substring("LEDGERLINE_API_KEY=".Length).Trim() }
$BaseUrl = $BaseUrl.TrimEnd("/")

Write-Host "Waking the service (up to a minute on the free plan)..."
Invoke-RestMethod "$BaseUrl/health" -TimeoutSec 120 | Out-Null

$code = "checkout_test_" + (Get-Date -Format "yyyyMMddHHmmss")
$account = Invoke-RestMethod "$BaseUrl/v1/accounts" -Method Post -Headers $headers `
  -ContentType "application/json" -Body (@{ code = $code } | ConvertTo-Json)
Write-Host "Opened account $($account.code) ($($account.id)), balance $($account.balance)"

$checkoutHeaders = $headers + @{ "Idempotency-Key" = "checkout-$code" }
$session = Invoke-RestMethod "$BaseUrl/v1/accounts/$($account.id)/checkout-sessions" -Method Post `
  -Headers $checkoutHeaders -ContentType "application/json" `
  -Body (@{ credits = $Credits; successUrl = "$BaseUrl/health"; cancelUrl = "$BaseUrl/health" } | ConvertTo-Json)

Write-Host ""
Write-Host "Pay on Stripe's test page (card 4242 4242 4242 4242, any future date, any CVC):"
Write-Host $session.url
Start-Process $session.url
Write-Host ""
Write-Host "Waiting for the payment to be credited (Stripe -> Hookline -> Ledgerline)..."

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 5
  $balance = (Invoke-RestMethod "$BaseUrl/v1/accounts/$($account.id)" -Headers $headers).balance
  if ($balance -gt 0) {
    Write-Host "Credited: balance is now $balance credits."
    $entries = Invoke-RestMethod "$BaseUrl/v1/accounts/$($account.id)/entries" -Headers $headers
    $entries.data | Format-Table kind, amount, reference, createdAt -AutoSize
    $verify = Invoke-RestMethod "$BaseUrl/v1/ledger/verify" -Headers $headers
    Write-Host "Ledger verifies: $($verify.ok)"
    exit 0
  }
}
Write-Host "Not credited after 5 minutes. Check the Stripe webhook's delivery log and Hookline's dead letters."
exit 1
