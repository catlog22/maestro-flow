param(
    [switch]$Json
)

$result = [ordered]@{
    platform = $env:OS
    wordInstalled = $false
    comAvailable = $false
    domAvailable = $false
    version = $null
    message = $null
}

if ($env:OS -ne "Windows_NT") {
    $result.message = "Current system is not Windows, so Word COM automation is unavailable."
}
else {
    try {
        $word = New-Object -ComObject Word.Application
        $result.wordInstalled = $true
        $result.comAvailable = $true
        $result.version = [string]$word.Version

        try {
            $doc = $word.Documents.Add()
            $null = $doc.Content
            $result.domAvailable = $true
            $doc.Close([ref]0)
            $result.message = "Microsoft Word is installed and COM/DOM automation is available."
        }
        catch {
            $result.message = "Microsoft Word was detected, but document DOM automation failed: $($_.Exception.Message)"
        }

        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
    catch {
        $result.message = "No usable Microsoft Word COM automation environment was detected. Install desktop Microsoft Word."
    }
}

if ($Json) {
    $result | ConvertTo-Json -Depth 4
}
else {
    $result.GetEnumerator() | ForEach-Object {
        "{0}: {1}" -f $_.Key, $_.Value
    }
}
