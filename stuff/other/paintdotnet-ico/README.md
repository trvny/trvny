# Paint.NET ICO FileType

Small dependency-free `.ico` file type plugin for Paint.NET 5.1.x.

## What it does

- adds **Windows Icon (`.ico`)** to Open and Save As,
- opens the largest image embedded in an ICO,
- supports modern PNG-backed and legacy BMP/DIB-backed icons,
- writes a real multi-image ICO container,
- exports 16, 20, 24, 32, 40, 48, 64, 128 and 256 px frames,
- preserves transparency,
- optionally preserves aspect ratio and pads with transparency,
- stores exported frames as PNG inside the ICO container.

The codec is plain C# and does not depend on Pillow, ImageSharp or another image package.

## Build

Requirements:

- .NET 9 SDK,
- Paint.NET 5.1.x installed or unpacked locally.

```powershell
dotnet build .\PaintDotNetIco.csproj -c Release
```
If Paint.NET is elsewhere:

```powershell
dotnet build .\PaintDotNetIco.csproj -c Release -p:PaintDotNetDir='D:\Apps\paint.net'
```

Install `Travny.PaintDotNet.IcoFileType.dll` in a `FileTypes` plugin directory:

- Classic: `C:\Program Files\Paint.NET\FileTypes`, or the per-user `Documents\Paint.NET App Files\FileTypes` alternative.
- Microsoft Store: `Documents\Paint.NET App Files\FileTypes`.
- Portable: `<Paint.NET directory>\FileTypes`.

Restart Paint.NET after copying the DLL.

## Compatibility

This adapter targets the stable Paint.NET 5.1 legacy FileType API because 5.2 is still pre-release. The ICO codec is intentionally isolated from Paint.NET APIs so a 5.2 adapter can reuse it when the new FileType API settles.

When opening a multi-image ICO, the plugin chooses the largest valid frame, preferring the highest bit depth when dimensions tie.
