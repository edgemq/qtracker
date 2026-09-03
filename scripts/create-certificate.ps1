$certPassword = "QTrackerDev2026!"
$pfxPath = "$((Get-Location).Path)\certs\qtracker.pfx"
$cerPath = "$((Get-Location).Path)\certs\qtracker.cer"

if (-not (Test-Path "certs")) {
    New-Item -ItemType Directory -Path "certs" -Force | Out-Null
}

Write-Host "Creating Code Signing Certificate for QTracker..."

# Generate Code Signing Certificate
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=QTracker Team, O=QTracker OpenSource, C=RU" `
    -KeySpec Signature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5)

Write-Host "Certificate created with thumbprint: $($cert.Thumbprint)"

# Export to PFX
$securePassword = ConvertTo-SecureString -String $certPassword -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Write-Host "Exported PFX: $pfxPath"

# Export to CER (Public)
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Write-Host "Exported CER: $cerPath"

# Create a 1-click installation script for Windows Trusted Roots
$installBatContent = @"
@echo off
:: BatchGotAdmin
:-------------------------------------
REM --> Check for permissions
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges to install certificate...
    powershell -Command "Start-Process cmd -ArgumentList '/c %~s0' -Verb RunAs"
    exit /b
)
:--------------------------------------
echo Installing QTracker Root Certificate into Trusted Root Certification Authorities...
certutil -addstore -f "Root" "%~dp0qtracker.cer"
echo.
echo ========================================================
echo Certificate successfully installed!
echo Windows SmartScreen will now recognize QTracker binaries.
echo ========================================================
pause
"@

Set-Content -Path "certs\install-cert.bat" -Value $installBatContent -Encoding OEM
Write-Host "Created certs\install-cert.bat"
