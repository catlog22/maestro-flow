param(
    [Parameter(Mandatory = $true)]
    [string]$DocPath,

    [Parameter(Mandatory = $true)]
    [string]$PdfPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$word = $null
$document = $null

try {
    $resolvedDoc = (Resolve-Path -LiteralPath $DocPath).Path
    $resolvedPdf = [System.IO.Path]::GetFullPath($PdfPath)
    $outDir = Split-Path -Parent $resolvedPdf
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    $document = $word.Documents.Open($resolvedDoc, $false, $false)

    foreach ($toc in $document.TablesOfContents) {
        try { $toc.Update() } catch {}
        try { $toc.UpdatePageNumbers() } catch {}
    }

    $story = $document.StoryRanges
    while ($story -ne $null) {
        try { $null = $story.Fields.Update() } catch {}
        try { $story = $story.NextStoryRange } catch { $story = $null }
    }

    $wdExportFormatPDF = 17
    $document.ExportAsFixedFormat($resolvedPdf, $wdExportFormatPDF)

    [pscustomobject]@{
        input = $resolvedDoc
        output = $resolvedPdf
        exported = $true
    } | ConvertTo-Json -Depth 4
}
finally {
    if ($document) {
        $document.Close([ref]0)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
    }

    if ($word) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }

    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}
