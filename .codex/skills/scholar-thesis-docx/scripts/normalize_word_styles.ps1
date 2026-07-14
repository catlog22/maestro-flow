param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputPath,

    [string]$ConfigPath,

    [switch]$AuditOnly,

    [switch]$InPlace,

    [switch]$Visible
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DefaultConfig {
    return @{
        styles = @{
            Body = @{
                TargetStyleName = "Body Text"
                BuiltinId = -1
                FontName = "Times New Roman"
                EastAsiaFontName = "SimSun"
                Size = 12
                Bold = $false
                Italic = $false
                Alignment = "Justify"
                FirstLineIndentCm = 0.74
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 0
                SpaceAfterPt = 0
                LineSpacingMultiple = 1.5
                KeepTogether = $false
                KeepWithNext = $false
                OutlineLevel = 10
            }
            Heading1 = @{
                TargetStyleName = "Heading 1"
                BuiltinId = -2
                FontName = "Times New Roman"
                EastAsiaFontName = "SimHei"
                Size = 16
                Bold = $true
                Italic = $false
                Alignment = "Center"
                FirstLineIndentCm = 0
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 18
                SpaceAfterPt = 12
                LineSpacingMultiple = 1.5
                KeepTogether = $true
                KeepWithNext = $true
                OutlineLevel = 1
            }
            Heading2 = @{
                TargetStyleName = "Heading 2"
                BuiltinId = -3
                FontName = "Times New Roman"
                EastAsiaFontName = "SimHei"
                Size = 14
                Bold = $true
                Italic = $false
                Alignment = "Left"
                FirstLineIndentCm = 0
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 12
                SpaceAfterPt = 6
                LineSpacingMultiple = 1.5
                KeepTogether = $true
                KeepWithNext = $true
                OutlineLevel = 2
            }
            Heading3 = @{
                TargetStyleName = "Heading 3"
                BuiltinId = -4
                FontName = "Times New Roman"
                EastAsiaFontName = "SimHei"
                Size = 12
                Bold = $true
                Italic = $false
                Alignment = "Left"
                FirstLineIndentCm = 0
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 6
                SpaceAfterPt = 6
                LineSpacingMultiple = 1.5
                KeepTogether = $true
                KeepWithNext = $true
                OutlineLevel = 3
            }
            FigureCaption = @{
                TargetStyleName = "Figure Caption"
                FontName = "Times New Roman"
                EastAsiaFontName = "SimSun"
                Size = 10.5
                Bold = $false
                Italic = $false
                Alignment = "Center"
                FirstLineIndentCm = 0
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 6
                SpaceAfterPt = 6
                LineSpacingMultiple = 1.0
                KeepTogether = $true
                KeepWithNext = $false
                OutlineLevel = 10
            }
            TableCaption = @{
                TargetStyleName = "Table Caption"
                FontName = "Times New Roman"
                EastAsiaFontName = "SimSun"
                Size = 10.5
                Bold = $false
                Italic = $false
                Alignment = "Center"
                FirstLineIndentCm = 0
                LeftIndentCm = 0
                RightIndentCm = 0
                SpaceBeforePt = 6
                SpaceAfterPt = 6
                LineSpacingMultiple = 1.0
                KeepTogether = $true
                KeepWithNext = $false
                OutlineLevel = 10
            }
        }
        patterns = @{
            FigureCaption = '^(Figure|Fig\.?|\u56FE)\s*[\dA-Za-z]+'
            TableCaption = '^(Table|\u8868)\s*[\dA-Za-z]+'
            Heading3 = '^(\d+\.\d+\.\d+)\s+\S+'
            Heading2 = '^(\d+\.\d+)\s+\S+'
            Heading1 = '^(Chapter\s+\d+|第[\u4E00-\u5341]+章|\d+\s+\S+)'
        }
        styleHints = @{
            FigureCaption = '(Figure Caption|Caption Figure|\u56FE)'
            TableCaption = '(Table Caption|Caption Table|\u8868)'
            Heading1 = '(Heading 1|\u6807\u9898 1)'
            Heading2 = '(Heading 2|\u6807\u9898 2)'
            Heading3 = '(Heading 3|\u6807\u9898 3)'
            Body = '(Body Text|Normal|\u6B63\u6587)'
        }
    }
}

function Merge-Hashtable {
    param(
        [hashtable]$Base,
        [hashtable]$Override
    )

    foreach ($key in $Override.Keys) {
        if ($Base.ContainsKey($key) -and $Base[$key] -is [hashtable] -and $Override[$key] -is [hashtable]) {
            Merge-Hashtable -Base $Base[$key] -Override $Override[$key]
        }
        else {
            $Base[$key] = $Override[$key]
        }
    }
}

function ConvertTo-Hashtable {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $hash = @{}
        foreach ($key in $Value.Keys) {
            $hash[$key] = ConvertTo-Hashtable -Value $Value[$key]
        }
        return $hash
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(ConvertTo-Hashtable -Value $item)
        }
        return $items
    }

    return $Value
}

function Get-AlignmentValue {
    param([object]$Value)

    if ($Value -is [int]) {
        return $Value
    }

    switch -Regex ([string]$Value) {
        '^Center$' { return 1 }
        '^Right$' { return 2 }
        '^Justify$' { return 3 }
        '^Distributed$' { return 4 }
        default { return 0 }
    }
}

function Get-ComBool {
    param([object]$Value)

    if ([bool]$Value) {
        return -1
    }

    return 0
}

function Resolve-Style {
    param(
        $Document,
        [string]$LogicalName,
        [hashtable]$StyleSpec
    )

    $targetName = $StyleSpec.TargetStyleName
    $builtinId = $null
    if ($StyleSpec.ContainsKey("BuiltinId")) {
        $builtinId = [int]$StyleSpec.BuiltinId
    }

    if ($targetName) {
        try {
            return $Document.Styles.Item($targetName)
        }
        catch {
        }
    }

    if ($null -ne $builtinId) {
        try {
            return $Document.Styles.Item($builtinId)
        }
        catch {
        }
    }

    if (-not $targetName) {
        throw "Style '$LogicalName' needs TargetStyleName when no built-in style is available."
    }

    return $Document.Styles.Add($targetName, 1)
}

function Apply-StyleSpec {
    param(
        $Word,
        $Style,
        [hashtable]$StyleSpec
    )

    if ($StyleSpec.ContainsKey("FontName")) {
        $Style.Font.Name = [string]$StyleSpec.FontName
    }

    if ($StyleSpec.ContainsKey("EastAsiaFontName")) {
        try {
            $Style.Font.NameFarEast = [string]$StyleSpec.EastAsiaFontName
        }
        catch {
        }
    }

    if ($StyleSpec.ContainsKey("Size")) {
        $Style.Font.Size = [double]$StyleSpec.Size
    }

    if ($StyleSpec.ContainsKey("Bold")) {
        $Style.Font.Bold = Get-ComBool -Value $StyleSpec.Bold
    }

    if ($StyleSpec.ContainsKey("Italic")) {
        $Style.Font.Italic = Get-ComBool -Value $StyleSpec.Italic
    }

    if ($StyleSpec.ContainsKey("Alignment")) {
        $Style.ParagraphFormat.Alignment = Get-AlignmentValue -Value $StyleSpec.Alignment
    }

    if ($StyleSpec.ContainsKey("FirstLineIndentCm")) {
        $Style.ParagraphFormat.FirstLineIndent = $Word.CentimetersToPoints([double]$StyleSpec.FirstLineIndentCm)
    }

    if ($StyleSpec.ContainsKey("LeftIndentCm")) {
        $Style.ParagraphFormat.LeftIndent = $Word.CentimetersToPoints([double]$StyleSpec.LeftIndentCm)
    }

    if ($StyleSpec.ContainsKey("RightIndentCm")) {
        $Style.ParagraphFormat.RightIndent = $Word.CentimetersToPoints([double]$StyleSpec.RightIndentCm)
    }

    if ($StyleSpec.ContainsKey("SpaceBeforePt")) {
        $Style.ParagraphFormat.SpaceBefore = [double]$StyleSpec.SpaceBeforePt
    }

    if ($StyleSpec.ContainsKey("SpaceAfterPt")) {
        $Style.ParagraphFormat.SpaceAfter = [double]$StyleSpec.SpaceAfterPt
    }

    if ($StyleSpec.ContainsKey("LineSpacingMultiple")) {
        $Style.ParagraphFormat.LineSpacingRule = 5
        $Style.ParagraphFormat.LineSpacing = $Word.LinesToPoints([double]$StyleSpec.LineSpacingMultiple)
    }

    if ($StyleSpec.ContainsKey("KeepTogether")) {
        $Style.ParagraphFormat.KeepTogether = Get-ComBool -Value $StyleSpec.KeepTogether
    }

    if ($StyleSpec.ContainsKey("KeepWithNext")) {
        $Style.ParagraphFormat.KeepWithNext = Get-ComBool -Value $StyleSpec.KeepWithNext
    }

    if ($StyleSpec.ContainsKey("OutlineLevel")) {
        $Style.ParagraphFormat.OutlineLevel = [int]$StyleSpec.OutlineLevel
    }
}

function Get-ParagraphText {
    param($Paragraph)
    return ($Paragraph.Range.Text -replace "[`r`n]+$", "").Trim()
}

function Get-StyleName {
    param($Paragraph)

    try {
        return [string]$Paragraph.Range.Style.NameLocal
    }
    catch {
        try {
            return [string]$Paragraph.Range.Style.Name
        }
        catch {
            return ""
        }
    }
}

function Get-ParagraphKind {
    param(
        [string]$Text,
        [string]$CurrentStyleName,
        [hashtable]$Config
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    foreach ($kind in @("FigureCaption", "TableCaption", "Heading1", "Heading2", "Heading3")) {
        if ($Config.styleHints.ContainsKey($kind) -and $CurrentStyleName -match $Config.styleHints[$kind]) {
            return $kind
        }
    }

    foreach ($kind in @("FigureCaption", "TableCaption", "Heading3", "Heading2", "Heading1")) {
        if ($Config.patterns.ContainsKey($kind) -and $Text -match $Config.patterns[$kind]) {
            return $kind
        }
    }

    if ($Config.styleHints.ContainsKey("Body") -and $CurrentStyleName -match $Config.styleHints.Body) {
        return "Body"
    }

    return "Body"
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
if (-not $InPlace -and -not $OutputPath) {
    $directory = Split-Path -Parent $resolvedInput
    $leaf = Split-Path -LeafBase $resolvedInput
    $extension = [System.IO.Path]::GetExtension($resolvedInput)
    $OutputPath = Join-Path $directory "$leaf.normalized$extension"
}

$config = Get-DefaultConfig
if ($ConfigPath) {
    $overrideObject = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $overrideConfig = ConvertTo-Hashtable -Value $overrideObject
    Merge-Hashtable -Base $config -Override $overrideConfig
}

$word = $null
$document = $null
$styles = @{}
$stats = @{
    Body = 0
    Heading1 = 0
    Heading2 = 0
    Heading3 = 0
    FigureCaption = 0
    TableCaption = 0
}
$previewChanges = New-Object System.Collections.Generic.List[object]

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = [bool]$Visible
    $word.DisplayAlerts = 0

    $document = $word.Documents.Open($resolvedInput, $false, $false)

    foreach ($logicalName in $config.styles.Keys) {
        $style = Resolve-Style -Document $document -LogicalName $logicalName -StyleSpec $config.styles[$logicalName]
        Apply-StyleSpec -Word $word -Style $style -StyleSpec $config.styles[$logicalName]
        $styles[$logicalName] = $style
    }

    foreach ($paragraph in $document.Paragraphs) {
        $text = Get-ParagraphText -Paragraph $paragraph
        if ([string]::IsNullOrWhiteSpace($text)) {
            continue
        }

        $currentStyleName = Get-StyleName -Paragraph $paragraph
        $kind = Get-ParagraphKind -Text $text -CurrentStyleName $currentStyleName -Config $config
        if (-not $kind) {
            continue
        }

        $targetStyle = $styles[$kind]
        $targetStyleName = ""
        try {
            $targetStyleName = [string]$targetStyle.NameLocal
        }
        catch {
            try {
                $targetStyleName = [string]$targetStyle.Name
            }
            catch {
                $targetStyleName = $kind
            }
        }

        if ($currentStyleName -ne $targetStyleName) {
            $previewChanges.Add([pscustomobject]@{
                kind = $kind
                fromStyle = $currentStyleName
                toStyle = $targetStyleName
                text = if ($text.Length -gt 80) { $text.Substring(0, 80) } else { $text }
            }) | Out-Null
        }

        if (-not $AuditOnly) {
            $paragraph.Range.Style = $targetStyle
            $stats[$kind]++
        }
    }

    if ($AuditOnly) {
        $finalPath = $resolvedInput
    }
    else {
        if ($InPlace) {
            $document.Save()
            $finalPath = $resolvedInput
        }
        else {
            $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
            $document.SaveAs([ref]$resolvedOutput)
            $finalPath = $resolvedOutput
        }
    }

    [pscustomobject]@{
        input = $resolvedInput
        output = $finalPath
        auditOnly = [bool]$AuditOnly
        stats = [pscustomobject]$stats
        previewChanges = $previewChanges
    } | ConvertTo-Json -Depth 5
}
finally {
    if ($document) {
        $document.Close([ref]0)
    }

    if ($word) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }

    [gc]::Collect()
    [gc]::WaitForPendingFinalizers()
}
