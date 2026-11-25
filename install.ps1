<#
.SYNOPSIS
    YS-pojia 破甲插件 - 一键安装

.EXAMPLE
    irm https://raw.githubusercontent.com/yushang657/DSH-YS-pojia/main/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string]$DshHomeArg = "",
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  $msg" }
function Write-Ok($msg) { Write-Host "  " -NoNewline; Write-Host "OK " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn2($msg) { Write-Host "  " -NoNewline; Write-Host "!  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Bad($msg) { Write-Host "  " -NoNewline; Write-Host "X  " -ForegroundColor Red -NoNewline; Write-Host $msg }

Write-Host ""
Write-Host "YS-pojia 破甲插件 - 一键安装" -ForegroundColor Cyan
Write-Host ""

# ---- 环境检查 ----

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Bad "没找到 Node.js，请先安装：https://nodejs.org/"
    exit 1
}

$nodeVer = & node -v
$major = [int](($nodeVer -replace '^v', '') -split '\.')[0]
if ($major -lt 18) {
    Write-Bad "Node.js 需要 18 或更高，当前 $nodeVer"
    exit 1
}
Write-Ok "Node.js $nodeVer"

# ---- 定位插件源码 ----

$pluginRoot = $null
$tmp = $null

if ($PSScriptRoot) {
    $candidate = $PSScriptRoot
} else {
    $candidate = (Get-Location).Path
}

$localPkg = Join-Path $candidate "package.json"
if (Test-Path $localPkg) {
    $pkg = Get-Content $localPkg -Raw | ConvertFrom-Json
    if ($pkg.name -eq "ys-pojia") {
        $pluginRoot = $candidate
        Write-Ok "使用本地源码: $pluginRoot"
    }
}

if (-not $pluginRoot) {
    Write-Step "本地没有源码，正在下载..."

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        Write-Bad "需要 git 才能下载：https://git-scm.com/download/win"
        exit 1
    }

    $tmpName = "ys-pojia-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $tmp = Join-Path $env:TEMP $tmpName

    $cloneOutput = & git clone --depth 1 https://github.com/yushang657/DSH-YS-pojia.git $tmp
    if ($LASTEXITCODE -ne 0) {
        Write-Bad "下载失败，检查网络后重试"
        exit 1
    }
    $pluginRoot = $tmp
    Write-Ok "下载完成"
}

# ---- 找 DSH HOME ----

function Test-DshHome {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $profiles = Join-Path $Path "profiles"
    return (Test-Path $profiles -PathType Container)
}

$candidates = New-Object System.Collections.ArrayList

if ($DshHomeArg) { [void]$candidates.Add($DshHomeArg) }
if ($env:DSH_HOME) { [void]$candidates.Add($env:DSH_HOME) }
[void]$candidates.Add((Join-Path $env:USERPROFILE ".dsh"))
[void]$candidates.Add((Join-Path $env:USERPROFILE ".dsh-community"))

$dshHome = $null
foreach ($c in $candidates) {
    if (Test-DshHome $c) {
        $dshHome = $c
        break
    }
}

if (-not $dshHome) {
    Write-Bad "没找到 DSH 的 HOME 目录"
    Write-Host ""
    Write-Step "找过这些位置："
    foreach ($c in $candidates) { Write-Step "  $c" }
    Write-Host ""
    Write-Step "如果 DSH 装在别处，用 -DshHomeArg 指定："
    Write-Step '  .\install.ps1 -DshHomeArg "C:\Users\你\.dsh"'
    exit 1
}
Write-Ok "DSH HOME: $dshHome"

# ---- 找可安装的 profile ----

$profilesDir = Join-Path $dshHome "profiles"
$allDirs = Get-ChildItem $profilesDir -Directory -ErrorAction SilentlyContinue

$profiles = @()
foreach ($d in $allDirs) {
    if ($d.Name.StartsWith(".")) { continue }
    if ($d.Name -like "*.backup-*") { continue }
    if (-not (Test-Path (Join-Path $d.FullName "cordis.patch.yml"))) { continue }
    # 真运行 profile 才有这个锁文件
    if (-not (Test-Path (Join-Path $d.FullName "desktop-plugins.lock.json"))) { continue }
    $profiles += $d
}

if ($profiles.Count -eq 0) {
    Write-Bad "没有可安装的 profile"
    Write-Step "先启动一次 DSH，让它生成 profiles 目录，再回来装。"
    exit 1
}

$names = ($profiles | ForEach-Object { $_.Name }) -join ", "
Write-Ok "找到 $($profiles.Count) 个 profile: $names"

# ---- 安装 ----

Write-Host ""
Write-Host "开始安装" -ForegroundColor Cyan

$blockLines = @(
    "- insert:",
    "    - id: ys-pojia",
    "      name: ys-pojia",
    "      inject: [ systemPrompt, tools ]",
    "      config:",
    "        enabled: true",
    "        stripMnemon: true",
    "        capabilityProtocol: true",
    "        hooksDenyBypass: true"
)

$results = @()

foreach ($p in $profiles) {
    Write-Host ""
    Write-Step "[$($p.Name)]"

    $pluginDir = Join-Path $p.FullName "node_modules\ys-pojia"
    $patchFile = Join-Path $p.FullName "cordis.patch.yml"

    # -- 复制 --
    $pluginExists = Test-Path $pluginDir

    if ($pluginExists -and -not $Force) {
        Write-Warn2 "插件已存在，跳过复制（-Force 强制覆盖）"
    } elseif ($DryRun) {
        Write-Step "  [dry-run] 会复制到 $pluginDir"
    } else {
        $copyOk = $true
        try {
            $rcArgs = @(
                $pluginRoot, $pluginDir,
                "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1",
                "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
                "/XD", ".git", "node_modules", "ai_workspace", "plugin-backups"
            )
            $null = & robocopy @rcArgs
            if ($LASTEXITCODE -ge 8) { throw "robocopy 返回 $LASTEXITCODE" }
            $copied = (Get-ChildItem $pluginDir -Recurse -File | Measure-Object).Count
            Write-Ok "复制 $copied 个文件"
        } catch {
            Write-Bad "复制失败: $_"
            $copyOk = $false
        }
        if (-not $copyOk) {
            $results += @{ Name = $p.Name; Ok = $false }
            continue
        }
    }

    # -- 注册 --
    $yaml = Get-Content $patchFile -Raw -Encoding UTF8
    $isRegistered = $false
    foreach ($line in ($yaml -split "`n")) {
        if ($line -match '^\s*-\s*id:\s*ys-pojia\s*$') {
            $isRegistered = $true
            break
        }
    }

    if ($isRegistered) {
        Write-Ok "已在 profile 里注册，跳过"
        $results += @{ Name = $p.Name; Ok = $true }
        continue
    }

    if ($DryRun) {
        Write-Step "  [dry-run] 会往 cordis.patch.yml 追加注册块"
        $results += @{ Name = $p.Name; Ok = $true }
        continue
    }

    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $bak = "$patchFile.bak-install-$stamp"

    try {
        Copy-Item $patchFile $bak -Force

        if ($yaml.Contains("`r`n")) { $eol = "`r`n" } else { $eol = "`n" }
        $add = ($blockLines -join $eol) + $eol
        $newYaml = $yaml.TrimEnd() + $eol + $eol + $add

        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($patchFile, $newYaml, $utf8NoBom)

        $bakName = Split-Path $bak -Leaf
        Write-Ok "已注册（备份: $bakName）"
        $results += @{ Name = $p.Name; Ok = $true }
    } catch {
        Write-Bad "注册失败: $_"
        try {
            Copy-Item $bak $patchFile -Force
            Write-Step "  已还原"
        } catch {
            Write-Step "  还原也失败了，请手动检查 $patchFile"
        }
        $results += @{ Name = $p.Name; Ok = $false }
    }
}

# ---- 汇总 ----

Write-Host ""

if ($DryRun) {
    Write-Host "[dry-run] 没有实际改动。" -ForegroundColor Yellow
    if ($tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    exit 0
}

$good = 0
$failed = 0
foreach ($r in $results) {
    if ($r.Ok) { $good++ } else { $failed++ }
}

if ($failed -eq 0) {
    Write-Host "安装完成" -ForegroundColor Green -NoNewline
    Write-Host "  $good 个 profile"
    Write-Host ""
    Write-Host "下一步" -ForegroundColor Cyan
    Write-Step "1. 完全退出 DSH（不是关窗口，要退进程）"
    Write-Step "2. 重新打开"
    Write-Step "3. 在对话框输入「小雨」两个字，看到四行回复就是装好了"
    Write-Host ""
    Write-Step "卸载: node bin/ys-pojia.js --uninstall"

    if ($tmp) {
        Write-Host ""
        Write-Step "清理临时文件..."
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Bad "有 $failed 个 profile 安装失败"
    Write-Step "失败的不影响其他 profile，可以单独重试。"
    exit 1
}
