using namespace System.Management.Automation
using namespace System.Management.Automation.Language
function prompt {
    $color = Get-Random -Min 1 -Max 16
    Write-Host ("PS " + $(Get-Location) +">") -NoNewLine -ForegroundColor $Color
    return " "
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
Import-Module PSCompletions
$PSReadLineOptions = @{
    PredictionSource = "HistoryAndPlugin"
    HistorySearchCursorMovesToEnd = $true
    TerminateOrphanedConsoleApps = $true
}
Set-PSReadLineOption @PSReadLineOptions
Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
Set-PSReadLineKeyHandler -Chord 'Tab' -Function MenuComplete
Set-PSReadLineKeyHandler -Chord 'Ctrl+Spacebar' -Function Complete
Set-PSReadLineKeyHandler -Chord 'Ctrl+RightArrow' -Function ForwardWord
Set-PSReadLineKeyHandler -Chord 'Ctrl+Backspace' -Function BackwardDeleteWord
Set-PSReadLineKeyHandler -Chord 'Shift+RightArrow' -Function AcceptNextSuggestionWord
