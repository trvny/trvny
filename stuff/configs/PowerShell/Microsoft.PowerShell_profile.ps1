function prompt {
    # Kolor MUSI byc sekwencja ANSI w zwracanym stringu, nie Write-Host.
    $color = Get-Random -Minimum 1 -Maximum 16
    "`e[38;5;${color}m" + "PS $(Get-Location)>" + "`e[0m "
}
Register-ArgumentCompleter -Native -CommandName winget -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
        [Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [System.Text.Utf8Encoding]::new()
        $Local:word = $wordToComplete.Replace('"', '""')
        $Local:ast = $commandAst.ToString().Replace('"', '""')
        winget complete --word="$Local:word" --commandline "$Local:ast" --position $cursorPosition | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
}
Import-Module -Name tiPS # Added by tiPS to get automatic tips and updates.
Import-Module PSCompletions
$PSReadLineOptions = @{
    PredictionSource = "HistoryAndPlugin"
    HistorySearchCursorMovesToEnd = $true
    TerminateOrphanedConsoleApps = $true
}
Set-PSReadLineOption @PSReadLineOptions
Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
Set-PSReadLineKeyHandler -Chord 'Shift+Tab' -Function MenuComplete
Set-PSReadLineKeyHandler -Chord 'Ctrl+Spacebar' -Function Complete
Set-PSReadLineKeyHandler -Chord 'Ctrl+RightArrow' -Function ForwardWord
Set-PSReadLineKeyHandler -Chord 'Ctrl+Backspace' -Function BackwardDeleteWord
Set-PSReadLineKeyHandler -Chord 'Shift+RightArrow' -Function AcceptNextSuggestionWord
# Completion z cache. gh/uvx generuja je odpalajac proces - wynik trafia do
# pliku i jest odswiezany co $CompletionMaxAgeDays.
# Odswiezenie na zadanie: Update-CompletionCache
#
# 'uv' celowo POMINIETE: jego completion ma 731 KB i samo parsowanie to ~75 ms
# na kazdy shell, a uzycie sprowadza sie do install/uninstall pakietu.
# Gdyby wrocilo: uv = { uv generate-shell-completion powershell }
$CompletionCache      = Join-Path $PSScriptRoot 'completion-cache'
$CompletionMaxAgeDays = 14
$CompletionSources    = [ordered]@{
    gh  = { gh completion -s powershell }
    uvx = { uvx --generate-shell-completion powershell }
}

function Get-CompletionCachePath {
    param([string]$Name, [scriptblock]$Generator, [switch]$Force)
    if (-not (Get-Command $Name -ErrorAction Ignore)) { return $null }
    if (-not (Test-Path -LiteralPath $CompletionCache)) {
        New-Item -ItemType Directory -Path $CompletionCache -Force | Out-Null
    }
    $file = Join-Path $CompletionCache "$Name.ps1"
    $stale = $Force -or -not (Test-Path -LiteralPath $file) -or
        ((Get-Item -LiteralPath $file).LastWriteTime -lt (Get-Date).AddDays(-$CompletionMaxAgeDays))
    if ($stale) {
        try {
            $text = & $Generator | Out-String
            if ($text.Trim()) { Set-Content -LiteralPath $file -Value $text -Encoding utf8 }
        }
        catch { Write-Warning "completion $Name : $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath $file) { $file }
}

function Update-CompletionCache {
    foreach ($n in $CompletionSources.Keys) {
        if (Get-CompletionCachePath -Name $n -Generator $CompletionSources[$n] -Force) { "ok: $n" }
        else { "pominiete: $n" }
    }
}

# Dot-source MUSI byc na tym poziomie. W funkcji trafiloby do jej scope i
# funkcje pomocnicze completion (np. __gh_debug) byly niewidoczne przy Tab.
# foreach nie tworzy nowego scope, wiec tutaj jest bezpiecznie.
foreach ($name in $CompletionSources.Keys) {
    $cached = Get-CompletionCachePath -Name $name -Generator $CompletionSources[$name]
    if ($cached) { . $cached }
}

# Scripts na PATH - tylko dla tej sesji, zeby nie ruszac HKCU\Environment
$ScriptsDir = Join-Path $PSScriptRoot 'Scripts'
if ((Test-Path -LiteralPath $ScriptsDir) -and ($env:Path -split ';' -notcontains $ScriptsDir)) {
    $env:Path += ";$ScriptsDir"
}

# DO NOT MODIFY -- coreutils -- 60b36fc6-2d59-49df-be51-28dd2f4c3c9a
# vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv
# Inlining the template into the profile shaves off ~10ms (25%).
$script:__COREUTILS__ = [System.Collections.Generic.HashSet[string]]::new(
    [string[]]@('arch','b2sum','base32','base64','basename','basenc','cat','cksum','comm','cp','csplit','cut','date','df','dirname','du','echo','env','expr','factor','false','find','fmt','fold','grep','head','hostname','join','la','link','ln','ls','md5sum','mkdir','mktemp','mv','nl','nproc','numfmt','od','paste','pathchk','pr','printenv','printf','ptx','pwd','readlink','realpath','rm','rmdir','seq','sha1sum','sha224sum','sha256sum','sha384sum','sha512sum','shuf','sleep','sort','split','stat','sum','tac','tail','tee','test','touch','tr','true','truncate','tsort','unexpand','uniq','unlink','uptime','wc','xargs','yes'),
    [System.StringComparer]::OrdinalIgnoreCase
)

$script:__COREUTILS_FAST_SKIP__ = [regex]::new(
    '\b(?:' + ($script:__COREUTILS__ -join '|') + ')\b',
    [System.Text.RegularExpressions.RegexOptions]::Compiled -bor `
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Casting the scriptblock to Func<Ast,bool> once and reusing it avoids the
# per-FindAll scriptblock-to-delegate wrapping overhead (~1.7x faster).
$script:__COREUTILS_CMD_PREDICATE__ = [System.Func[System.Management.Automation.Language.Ast, bool]] {
    param($n) $n -is [System.Management.Automation.Language.CommandAst]
}

$script:__COREUTILS_ARG_SPECIAL__ = [char[]] @("'", '"', '`', '$')

# Wrap arguments into quotes. By being a function we can properly handle $variables.
# As per MSVCRT, any `\` before `"` must be doubled to escape them.
function global:__coreutils_q {
    param($s)
    '"' + (([string]$s) -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# PowerShell tokenizes `*"a"*` as [BareWord] instead of the expected [DoubleQuoted, BareWord, DoubleQuoted].
# To work around that we use... regex. Group 1 = 'single', 2 = "double", 3 = `escape, 4 = bare run.
$script:__COREUTILS_ARG_RX__ = [regex]::new(
    "'((?:[^']|'')*)'|""((?:[^""``]|""""|``.)*)""|``(.)|([^'""``]+)",
    [System.Text.RegularExpressions.RegexOptions]::Compiled
)
$script:__COREUTILS_ARG_EVAL__ = [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    if ($m.Groups[1].Success) {
        # Single-quoted: literal. PS '' -> ', then MSVCRT-quote.
        $body = $m.Groups[1].Value.Replace("''", "'")
        if ($body -match '^(.*?)(\\+)$') {
            return '"' + ($matches[1] -replace '(\\*)"', '$1$1\"') + '"' + $matches[2]
        }
        return '"' + ($body -replace '(\\*)"', '$1$1\"') + '"'
    }
    if ($m.Groups[2].Success) {
        # Double-quoted: collapse PS quote-escapes to raw " / ', let ExpandString
        # resolve `n / `t / $var, then MSVCRT-quote.
        $body = $m.Groups[2].Value.
        Replace('`"', '"').
        Replace("``'", "'").
        Replace('""', '"')
        $body = $ExecutionContext.InvokeCommand.ExpandString($body)
        if ($body -match '^(.*?)(\\+)$') {
            return '"' + ($matches[1] -replace '(\\*)"', '$1$1\"') + '"' + $matches[2]
        }
        return '"' + ($body -replace '(\\*)"', '$1$1\"') + '"'
    }
    if ($m.Groups[3].Success) {
        # Backtick-escaped char outside a string: " -> \"; everything else
        # becomes a one-char quoted region so glob metas stay literal.
        $c = $m.Groups[3].Value
        if ($c -eq '"') {
            return '\"'
        }
        return '"' + $c + '"'
    }
    # Bare run: passed through unquoted so coreutils can glob it; expand $vars.
    return $ExecutionContext.InvokeCommand.ExpandString($m.Groups[4].Value)
}

# 0: not tested, 1: coreutils not installed, 2: coreutils installed.
$script:__COREUTILS_CMD_DIR_TEST__ = 0

# PSConsoleHostReadLine override that rewrites coreutils command names to their
# .cmd equivalents after PSReadLine returns (history keeps the original).
#
# Why .cmd over .exe: PSNativeCommandArgumentPassing = 'Windows' results in a behavior
# where passing bare quotes to CreateProcess() is impossible. This prevents us from
# passing "*" as "*" to coreutils and instead will be given as a bare *.
# This causes it to treat it as a glob pattern. "*.cmd" files however are automatically
# treated as PSNativeCommandArgumentPassing = 'Legacy', which preserves quotes.
# It is the only possible workaround and the only way coreutils can work at all.
function PSConsoleHostReadLine {
    [System.Diagnostics.DebuggerHidden()]
    param()

    $lastRunStatus = $?
    Microsoft.PowerShell.Core\Set-StrictMode -Off
    $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($host.Runspace, $ExecutionContext, $lastRunStatus)

    # If the line contains no coreutils name, we don't need to parse the AST at all.
    if (-not $script:__COREUTILS_FAST_SKIP__.IsMatch($line)) {
        return $line
    }

    # Roamed/synced profiles can load this snippet on machines where coreutils is not installed.
    # Test for the existence of the command directory once and remember the result.
    if ($script:__COREUTILS_CMD_DIR_TEST__ -eq 0) {
        $script:__COREUTILS_CMD_DIR_TEST__ = 1
        if (Test-Path -LiteralPath 'C:\Program Files\coreutils\cmd\' -PathType Container -ErrorAction Ignore) {
            $script:__COREUTILS_CMD_DIR_TEST__ = 2
        }
    }
    if ($script:__COREUTILS_CMD_DIR_TEST__ -ne 2) {
        return $line
    }

    $ast = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$null, [ref]$null)
    $commands = $ast.FindAll($script:__COREUTILS_CMD_PREDICATE__, $true)

    # Process right-to-left so earlier offsets stay valid after each splice.
    # In-place reverse beats Sort-Object for the typical 1-command line.
    if ($commands.Count -gt 1) {
        $commands = [System.Collections.Generic.List[object]]::new($commands)
        $commands.Reverse()
    }

    foreach ($cmd in $commands) {
        $name = $cmd.GetCommandName()
        if (!$name) {
            continue
        }

        $baseName = $name
        if ($name.EndsWith('.exe') -or $name.EndsWith('.cmd')) {
            $baseName = $name.Substring(0, $name.Length - 4)
        }
        if (!$script:__COREUTILS__.Contains($baseName)) {
            continue
        }

        # ls/la get colour + listing flags injected; la also rewrites to ls.
        $cmdElement = $cmd.CommandElements[0]
        $start = $cmdElement.Extent.StartOffset
        $end = $cmdElement.Extent.EndOffset
        $replacement = "& 'C:\Program Files\coreutils\cmd\"

        switch ($baseName) {
            'la' { $replacement += "ls.cmd' --color=auto -AFhl" }
            'ls' { $replacement += "ls.cmd' --color=auto" }
            default { $replacement += "$baseName.cmd'" }
        }

        # Walk command elements, merging adjacent ones whose extents touch
        # (e.g. `'a'*` parses as [SingleQuoted, BareWord] but is one shell word).
        # The inverse case `*'a'*` parses as a single BareWord whose text
        # contains the embedded quotes, which is why AST-only analysis
        # isn't enough and we still need to re-tokenize the source span.
        $argsStart = $end
        $argsEnd = $cmd.Extent.EndOffset
        $rewrittenArgs = ''
        $elements = $cmd.CommandElements
        $count = $elements.Count
        $i = 1
        while ($i -lt $count) {
            $first = $elements[$i]
            $wordStart = $first.Extent.StartOffset
            $wordEnd = $first.Extent.EndOffset
            $merged = $false
            while ($i + 1 -lt $count -and $elements[$i + 1].Extent.StartOffset -eq $wordEnd) {
                $i++
                $wordEnd = $elements[$i].Extent.EndOffset
                $merged = $true
            }
            $source = $line.Substring($wordStart, $wordEnd - $wordStart)
            $rewrittenArgs += $line.Substring($argsStart, $wordStart - $argsStart)
            $argsStart = $wordEnd
            # IndexOfAny beats running the regex per arg.
            if ($source.IndexOfAny($script:__COREUTILS_ARG_SPECIAL__) -lt 0) {
                $rewrittenArgs += $source
                $i++
                continue
            }
            # A single un-merged PS expression that needs $var resolution
            # (bare $var, "...$var...", $x.Member, $($expr), etc.).
            # Defer evaluation to runtime so the value reaches coreutils as a literal arg.
            # This matches POSIX behaviour where variable expansions don't result in globbing.
            if (-not $merged -and
                ($first -is [System.Management.Automation.Language.VariableExpressionAst] -or
                $first -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
                $first -is [System.Management.Automation.Language.MemberExpressionAst])) {
                $rewrittenArgs += '(__coreutils_q ' + $source + ')'
                $i++
                continue
            }
            # Slow path: re-tokenise and re-emit as MSVCRT-style quoting,
            # then wrap in PS single quotes so PS hands the body verbatim.
            $windowsQuoted = $script:__COREUTILS_ARG_RX__.Replace($source, $script:__COREUTILS_ARG_EVAL__)
            $rewrittenArgs += "'" + $windowsQuoted.Replace("'", "''") + "'"
            $i++
        }
        $rewrittenArgs += $line.Substring($argsStart, $argsEnd - $argsStart)

        $line = $line.Substring(0, $start) + $replacement + $rewrittenArgs + $line.Substring($argsEnd)
    }

    return $line
}
# ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
# --- carapace wylaczone tymczasowo 2026-07-26 (kolidowalo z gh/winget/PSCompletions) ---
# $env:CARAPACE_TOOLTIP = 1
# carapace _carapace | Out-String | Invoke-Expression