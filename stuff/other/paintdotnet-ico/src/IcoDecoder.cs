using System;
using System.Buffers.Binary;
using System.Drawing;
using System.IO;

namespace Travny.PaintDotNetIco;

internal static class IcoDecoder
{
    public static Bitmap ReadLargestBitmap(Stream input)
    {
        ArgumentNullException.ThrowIfNull(input);
        using var copy = new MemoryStream();
        input.CopyTo(copy);
        byte[] bytes = copy.ToArray();

        IcoEntry entry = FindLargestEntry(bytes);
        using MemoryStream singleIcon = BuildSingleEntryIcon(bytes, entry);
        using var icon = new Icon(singleIcon);
        return icon.ToBitmap();
    }

    private static IcoEntry FindLargestEntry(byte[] bytes)
    {
        if (bytes.Length < 22 || ReadUInt16(bytes, 0) != 0 || ReadUInt16(bytes, 2) != 1)
            throw new InvalidDataException("Not a valid Windows icon file.");

        int count = ReadUInt16(bytes, 4);
        if (count <= 0 || bytes.Length < 6 + (count * 16))
            throw new InvalidDataException("ICO directory is truncated.");

        IcoEntry? best = null;
        for (int i = 0; i < count; i++)
        {
            int offset = 6 + (i * 16);
            int width = bytes[offset] == 0 ? 256 : bytes[offset];
            int height = bytes[offset + 1] == 0 ? 256 : bytes[offset + 1];
            int bitCount = ReadUInt16(bytes, offset + 6);
            int dataLength = checked((int)ReadUInt32(bytes, offset + 8));
            int dataOffset = checked((int)ReadUInt32(bytes, offset + 12));

            if (dataLength <= 0 || dataOffset < 0 || dataOffset > bytes.Length - dataLength)
                continue;

            var candidate = new IcoEntry(width, height, bitCount, dataLength, dataOffset);
            if (best is null || candidate.Score > best.Value.Score)
                best = candidate;
        }

        return best ?? throw new InvalidDataException("ICO contains no readable images.");
    }

    private static MemoryStream BuildSingleEntryIcon(byte[] source, IcoEntry entry)
    {
        var output = new MemoryStream(22 + entry.DataLength);
        using var writer = new BinaryWriter(output, System.Text.Encoding.UTF8, leaveOpen: true);

        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)1);
        writer.Write((byte)(entry.Width == 256 ? 0 : entry.Width));
        writer.Write((byte)(entry.Height == 256 ? 0 : entry.Height));
        writer.Write((byte)0);
        writer.Write((byte)0);
        writer.Write((ushort)1);
        writer.Write((ushort)entry.BitCount);
        writer.Write((uint)entry.DataLength);
        writer.Write((uint)22);
        writer.Write(source, entry.DataOffset, entry.DataLength);
        writer.Flush();
        output.Position = 0;
        return output;
    }

    private static ushort ReadUInt16(byte[] bytes, int offset) =>
        BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(offset, 2));

    private static uint ReadUInt32(byte[] bytes, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset, 4));

    private readonly record struct IcoEntry(
        int Width, int Height, int BitCount, int DataLength, int DataOffset)
    {
        public long Score => ((long)Width * Height << 16) + Math.Max(BitCount, 0);
    }
}
