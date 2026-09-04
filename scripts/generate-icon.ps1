#requires -Version 5.1
<#
.SYNOPSIS
  Generates a kawaii cat-face icon (PNG + ICO) for KawaiiGPT.
.DESCRIPTION
  Uses .NET System.Drawing to draw a 256x256 kawaii cat face with pink/purple
  gradient theme, then saves as PNG and embeds into an ICO file (Windows Vista+
  format – PNG stored directly inside ICO container).
#>

Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$ResourcesDir = Join-Path $ProjectRoot "resources"
if (-not (Test-Path $ResourcesDir)) { New-Item -ItemType Directory -Path $ResourcesDir | Out-Null }

$PngPath = Join-Path $ResourcesDir "icon.png"
$IcoPath = Join-Path $ResourcesDir "icon.ico"

# ── Draw 256×256 kawaii cat face ──────────────────────────────────────────────

$S = 256
$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Helper: color from hex
function C([string]$hex) {
    [System.Drawing.Color]::FromArgb(
        [Convert]::ToInt32($hex.Substring(1,2),16),
        [Convert]::ToInt32($hex.Substring(3,2),16),
        [Convert]::ToInt32($hex.Substring(5,2),16))
}
function CA([int]$a,[string]$hex) {
    [System.Drawing.Color]::FromArgb($a,
        [Convert]::ToInt32($hex.Substring(1,2),16),
        [Convert]::ToInt32($hex.Substring(3,2),16),
        [Convert]::ToInt32($hex.Substring(5,2),16))
}

# ── 1. Background gradient (deep purple → kawaii purple) ─────────────────────
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    [System.Drawing.Rectangle]::new(0,0,$S,$S),
    [System.Drawing.Color]::FromArgb(255,25,15,50),
    [System.Drawing.Color]::FromArgb(255,80,40,120),
    [System.Drawing.Drawing2D.LinearGradientMode]::Diagonal)
$g.FillRectangle($bgBrush, 0, 0, $S, $S)
$bgBrush.Dispose()

# Soft glow circle behind face
$glowBrush = New-Object System.Drawing.Drawing2D.RadialGradientBrush(
    [System.Drawing.PointF]::new(128,130),
    [System.Drawing.Drawing2D.ColorBlend]::new())

# Use a Path gradient instead (RadialGradientBrush is called PathGradientBrush in .NET)
$gPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$gPath.AddEllipse(20, 25, 216, 212)
$pgBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($gPath)
$pgBrush.CenterColor       = [System.Drawing.Color]::FromArgb(120,255,182,213)
$pgBrush.SurroundColors    = @([System.Drawing.Color]::FromArgb(0,200,100,220))
$pgBrush.CenterPoint       = [System.Drawing.PointF]::new(128,130)
$g.FillEllipse($pgBrush, 20, 25, 216, 212)
$pgBrush.Dispose(); $gPath.Dispose()

# ── 2. Cat ears (pink filled with lighter inner triangle) ────────────────────
$earColor   = [System.Drawing.Color]::FromArgb(255, 230, 100, 170)
$earInner   = [System.Drawing.Color]::FromArgb(255, 255, 180, 210)

# Left ear
$leftEar = @(
    [System.Drawing.PointF]::new(42,  110),
    [System.Drawing.PointF]::new(28,  40),
    [System.Drawing.PointF]::new(108, 90)
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush($earColor)), $leftEar)

$leftEarIn = @(
    [System.Drawing.PointF]::new(52,  100),
    [System.Drawing.PointF]::new(45,  60),
    [System.Drawing.PointF]::new(95,  90)
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush($earInner)), $leftEarIn)

# Right ear
$rightEar = @(
    [System.Drawing.PointF]::new(214, 110),
    [System.Drawing.PointF]::new(228, 40),
    [System.Drawing.PointF]::new(148, 90)
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush($earColor)), $rightEar)

$rightEarIn = @(
    [System.Drawing.PointF]::new(204, 100),
    [System.Drawing.PointF]::new(211, 60),
    [System.Drawing.PointF]::new(161, 90)
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush($earInner)), $rightEarIn)

# ── 3. Face base circle ───────────────────────────────────────────────────────
$faceBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush(
    (New-Object System.Drawing.Drawing2D.GraphicsPath))
$facePath = New-Object System.Drawing.Drawing2D.GraphicsPath
$facePath.AddEllipse(48, 80, 160, 155)
$facePG = New-Object System.Drawing.Drawing2D.PathGradientBrush($facePath)
$facePG.CenterColor    = [System.Drawing.Color]::FromArgb(255, 255, 250, 252)
$facePG.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 250, 220, 240))
$g.FillEllipse($facePG, 48, 80, 160, 155)
$facePG.Dispose(); $facePath.Dispose()

# Face outline
$outlinePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60,200,120,180), 2)
$g.DrawEllipse($outlinePen, 48, 80, 160, 155)
$outlinePen.Dispose()

# ── 4. Eyes ───────────────────────────────────────────────────────────────────
# Whites
$eyeWhite = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,255,255,255))
$g.FillEllipse($eyeWhite, 82,  138, 32, 32)
$g.FillEllipse($eyeWhite, 142, 138, 32, 32)
$eyeWhite.Dispose()

# Irises (purple)
$irisBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 120, 60, 200))
$g.FillEllipse($irisBrush, 87,  143, 22, 22)
$g.FillEllipse($irisBrush, 147, 143, 22, 22)
$irisBrush.Dispose()

# Pupils
$pupilBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 10, 50))
$g.FillEllipse($pupilBrush, 92,  148, 12, 12)
$g.FillEllipse($pupilBrush, 152, 148, 12, 12)
$pupilBrush.Dispose()

# Shine specks
$shineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillEllipse($shineBrush, 94,  150,  6,  6)
$g.FillEllipse($shineBrush, 100, 156,  3,  3)
$g.FillEllipse($shineBrush, 154, 150,  6,  6)
$g.FillEllipse($shineBrush, 160, 156,  3,  3)
$shineBrush.Dispose()

# Eye lashes (simple arcs)
$lashPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180,80,40,100), 2)
$g.DrawArc($lashPen, 82,  134, 32, 18, 200, 140)
$g.DrawArc($lashPen, 142, 134, 32, 18, 200, 140)
$lashPen.Dispose()

# ── 5. Nose (small oval, pink) ────────────────────────────────────────────────
$noseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 130, 170))
$g.FillEllipse($noseBrush, 121, 174, 14, 9)
$noseBrush.Dispose()

# ── 6. Mouth (W-shape = kawaii cat) ──────────────────────────────────────────
$mouthPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 210, 80, 130), 3)
$mouthPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$mouthPen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($mouthPen, 108, 178, 20, 14, 0, 180)
$g.DrawArc($mouthPen, 128, 178, 20, 14, 0, 180)
$mouthPen.Dispose()

# ── 7. Blush circles ──────────────────────────────────────────────────────────
$blushBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 140, 180))
$g.FillEllipse($blushBrush, 58,  165, 38, 22)
$g.FillEllipse($blushBrush, 160, 165, 38, 22)
$blushBrush.Dispose()

# ── 8. Whiskers ───────────────────────────────────────────────────────────────
$whiskerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(130, 200, 150, 190), 1.5)
# Left
$g.DrawLine($whiskerPen, 50,  173, 112, 178)
$g.DrawLine($whiskerPen, 48,  182, 112, 183)
$g.DrawLine($whiskerPen, 52,  191, 112, 188)
# Right
$g.DrawLine($whiskerPen, 144, 178, 206, 173)
$g.DrawLine($whiskerPen, 144, 183, 208, 182)
$g.DrawLine($whiskerPen, 144, 188, 204, 191)
$whiskerPen.Dispose()

# ── 9. Decorative sparkles/stars ─────────────────────────────────────────────
function Draw-Star([System.Drawing.Graphics]$gr, [float]$cx, [float]$cy, [float]$r, [System.Drawing.Color]$col) {
    $starBrush = New-Object System.Drawing.SolidBrush($col)
    $pts = [System.Drawing.PointF[]]::new(8)
    for ($i = 0; $i -lt 8; $i++) {
        $angle = [Math]::PI * $i / 4 - [Math]::PI/2
        $rad   = if ($i % 2 -eq 0) { $r } else { $r * 0.4 }
        $pts[$i] = [System.Drawing.PointF]::new(
            $cx + $rad * [Math]::Cos($angle),
            $cy + $rad * [Math]::Sin($angle))
    }
    $gr.FillPolygon($starBrush, $pts)
    $starBrush.Dispose()
}

$gold   = [System.Drawing.Color]::FromArgb(255, 255, 220, 80)
$pink   = [System.Drawing.Color]::FromArgb(200, 255, 160, 200)
$white  = [System.Drawing.Color]::FromArgb(200, 255, 255, 255)

Draw-Star $g  26  60  9  $gold
Draw-Star $g 230  55  7  $gold
Draw-Star $g  18 170  6  $pink
Draw-Star $g 237 175  8  $pink
Draw-Star $g 128  22  5  $white
Draw-Star $g  60  50  4  $white
Draw-Star $g 198  50  4  $white

# Small hearts near top
function Draw-Heart([System.Drawing.Graphics]$gr, [float]$cx, [float]$cy, [float]$sz, [System.Drawing.Color]$col) {
    $hb = New-Object System.Drawing.SolidBrush($col)
    $hp = New-Object System.Drawing.Drawing2D.GraphicsPath
    # Heart from two bezier curves
    $hp.AddBezier($cx,       $cy+$sz/4,
                  $cx,       $cy-$sz*.3,
                  $cx+$sz/2, $cy-$sz*.3,
                  $cx+$sz/2, $cy+$sz/4)
    $hp.AddBezier($cx+$sz/2, $cy+$sz/4,
                  $cx+$sz,   $cy-$sz*.3,
                  $cx+$sz,   $cy-$sz*.3,
                  $cx+$sz,   $cy+$sz/4)
    $hp.AddBezier($cx+$sz,   $cy+$sz/4,
                  $cx+$sz,   $cy+$sz*.7,
                  $cx+$sz/2, $cy+$sz,
                  $cx+$sz/2, $cy+$sz)
    $hp.AddBezier($cx+$sz/2, $cy+$sz,
                  $cx,       $cy+$sz*.7,
                  $cx,       $cy+$sz*.7,
                  $cx,       $cy+$sz/4)
    $gr.FillPath($hb, $hp)
    $hb.Dispose(); $hp.Dispose()
}

Draw-Heart $g  30  195  11  [System.Drawing.Color]::FromArgb(180,255,120,180)
Draw-Heart $g 210  190  10  [System.Drawing.Color]::FromArgb(180,255,140,200)

$g.Dispose()

# ── Save PNG ──────────────────────────────────────────────────────────────────
$bmp.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "PNG saved: $PngPath"

# ── Save ICO (PNG-in-ICO container, Windows Vista+ compatible) ───────────────
$pngBytes = [System.IO.File]::ReadAllBytes($PngPath)

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

# ICONDIR
$bw.Write([uint16]0)   # reserved
$bw.Write([uint16]1)   # type: 1 = ICO
$bw.Write([uint16]1)   # image count

# ICONDIRENTRY
$bw.Write([byte]0)     # width  (0 = 256)
$bw.Write([byte]0)     # height (0 = 256)
$bw.Write([byte]0)     # color count
$bw.Write([byte]0)     # reserved
$bw.Write([uint16]1)   # color planes
$bw.Write([uint16]32)  # bits per pixel
$bw.Write([uint32]$pngBytes.Length)  # size of image data
$bw.Write([uint32]22)  # offset: 6 (ICONDIR) + 16 (ICONDIRENTRY) = 22

# Image data
$bw.Write($pngBytes)
$bw.Flush()

[System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
$ms.Dispose()
$bmp.Dispose()

Write-Host "ICO saved: $IcoPath"
Write-Host "Done! Icon generated successfully." -ForegroundColor Cyan
