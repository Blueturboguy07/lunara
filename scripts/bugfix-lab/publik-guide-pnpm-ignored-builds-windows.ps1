# Oracle body for cluster publik-guide-pnpm-ignored-builds-windows (Lunara half).
#
# Reproduces exactly what the guide has the reader type on Windows (rendered
# from lib/guides/lunara.ts via render-guide.mts), against a caller-supplied
# commit (defaults to the guide's current sourceCommit). Installs pnpm the
# same way the guide does (`npm install -g pnpm`) rather than pinning a
# version, because the reader-visible failure depends on whatever version
# that install lands on today.
#
# Prints BUGFIX_LAB_PRESENT and exits 1 if `pnpm install` or the native:sync
# step fails with ERR_PNPM_IGNORED_BUILDS (or any non-zero exit). Prints
# BUGFIX_LAB_ABSENT and exits 0 if both complete.

param(
  [string]$PinSha = "91e7e9ebf96ae556a2016787fe007500033237e0"
)

$ErrorActionPreference = "Continue"
Write-Host "=== pnpm version installed by the guide's own step ==="
npm.cmd install -g pnpm
pnpm.cmd --version

Write-Host "=== checkout pinned commit $PinSha ==="
git checkout $PinSha
if ($LASTEXITCODE -ne 0) {
  Write-Host "BUGFIX_LAB_ABSENT (oracle setup failure: checkout failed, not a repro)"
  exit 2
}

Write-Host "=== pnpm.cmd install (verbatim guide step 7) ==="
pnpm.cmd install 2>&1 | Tee-Object -Variable installOutput
$installExit = $LASTEXITCODE
$installOutput | Write-Host
$installIgnored = ($installOutput -join "`n") -match "ERR_PNPM_IGNORED_BUILDS"

if ($installExit -ne 0 -or $installIgnored) {
  Write-Host "EVIDENCE: pnpm install exited $installExit, ERR_PNPM_IGNORED_BUILDS matched=$installIgnored"
  Write-Host "BUGFIX_LAB_PRESENT"
  exit 1
}

Write-Host "=== pnpm.cmd --filter @lunara/app native:sync (verbatim guide step 8) ==="
pnpm.cmd --filter '@lunara/app' native:sync 2>&1 | Tee-Object -Variable syncOutput
$syncExit = $LASTEXITCODE
$syncOutput | Write-Host
$syncIgnored = ($syncOutput -join "`n") -match "ERR_PNPM_IGNORED_BUILDS"

if ($syncExit -ne 0 -or $syncIgnored) {
  Write-Host "EVIDENCE: native:sync exited $syncExit, ERR_PNPM_IGNORED_BUILDS matched=$syncIgnored"
  Write-Host "BUGFIX_LAB_PRESENT"
  exit 1
}

Write-Host "BUGFIX_LAB_ABSENT"
exit 0
