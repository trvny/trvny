using PaintDotNet;
using PaintDotNet.PropertySystem;
using PaintDotNet.Rendering;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;

namespace Travny.PaintDotNetIco;

[PluginSupportInfo(typeof(PluginSupportInfo))]
public sealed class IcoFileType : PropertyBasedFileType
{
    private const string PreserveAspectRatio = "Preserve aspect ratio";
    private const string Size16 = "16 x 16";
    private const string Size20 = "20 x 20";
    private const string Size24 = "24 x 24";
    private const string Size32 = "32 x 32";
    private const string Size40 = "40 x 40";
    private const string Size48 = "48 x 48";
    private const string Size64 = "64 x 64";
    private const string Size128 = "128 x 128";
    private const string Size256 = "256 x 256";

    private static readonly (string Name, int Size)[] SizeProperties =
    {
        (Size16, 16), (Size20, 20), (Size24, 24),
        (Size32, 32), (Size40, 40), (Size48, 48),
        (Size64, 64), (Size128, 128), (Size256, 256)
    };

    public IcoFileType()
        : base(
            "Windows Icon",
            new FileTypeOptions
            {
                LoadExtensions = Array.Empty<string>(),
                SaveExtensions = new[] { ".ico" },
                SupportsCancellation = false,
                SupportsLayers = false
            })
    {
    }

    public override PropertyCollection OnCreateSavePropertyCollection()
    {
        var properties = new List<Property>
        {
            new BooleanProperty(PreserveAspectRatio, true)
        };

        foreach ((string name, int _) in SizeProperties)
        {
            properties.Add(new BooleanProperty(name, true));
        }

        return new PropertyCollection(properties);
    }

    protected override Document OnLoad(Stream input) =>
        throw new NotSupportedException("ICO loading is not supported yet.");

    protected override void OnSaveT(
        Document input,
        Stream output,
        PropertyBasedSaveConfigToken token,
        Surface scratchSurface,
        ProgressEventHandler progressCallback)
    {
        scratchSurface.Clear();
        input.CreateRenderer().Render(scratchSurface);

        var sizes = new List<int>(SizeProperties.Length);
        foreach ((string name, int size) in SizeProperties)
        {
            if (Convert.ToBoolean(token.GetProperty(name)!.Value))
            {
                sizes.Add(size);
            }
        }

        bool preserve = Convert.ToBoolean(token.GetProperty(PreserveAspectRatio)!.Value);
        using Bitmap source = scratchSurface.CreateAliasedBitmap();
        IcoEncoder.Write(output, source, sizes, preserve);
    }
}
