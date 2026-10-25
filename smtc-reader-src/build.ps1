Write-Host "Publishing self-contained smtc-reader.exe..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o "../bin"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully published to bin/smtc-reader.exe!" -ForegroundColor Green
} else {
    Write-Host "Publish failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
