# Paint.NET ICO FileType

Small dependency-free `.ico` exporter for Paint.NET 5.1.x.

## What it does

- adds **Windows Icon (`.ico`)** to Save As,
- writes a real multi-image ICO container,
- exports 16, 20, 24, 32, 40, 48, 64, 128 and 256 px frames,
- preserves transparency,
- optionally preserves aspect ratio and pads with transparency,
- stores each frame as PNG inside the ICO container.

The encoder is plain C# and does not depend on Pillow, ImageSharp or another image package.

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

Copy `Travny.PaintDotNet.IcoFileType.dll` to:

```text
Documents\Paint.NET App Files\FileTypes
```

and restart Paint.NET.

## Compatibility

This adapter targets the stable Paint.NET 5.1 legacy FileType API because 5.2 is still pre-release. The ICO encoder is intentionally isolated from Paint.NET APIs so a 5.2 adapter can reuse it when the new FileType API settles.

Loading `.ico` files is not implemented yet; v0.1 focuses on reliable export.
