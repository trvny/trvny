using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace Travny.PaintDotNetIco;

internal sealed record IcoFrame(
    int Index,
    int Width,
    int Height,
    byte ColorCount,
    byte Reserved,
    ushort Planes,
    ushort BitCount,
    int DataLength,
    int DataOffset,
    bool IsPng)
{
    public long Score => ((long)Width * Height << 16) + BitCount;
}

internal sealed class IcoDocument
{
    private readonly byte[] data;

    public IcoDocument(byte[] data, IReadOnlyList<IcoFrame> frames)
    {
        this.data = data;
        Frames = frames;
    }

    public IReadOnlyList<IcoFrame> Frames { get; }

    public int FindDefaultFrameIndex()
    {
        foreach ((IcoFrame frame, int index) in Frames
                     .Select((frame, index) => (frame, index))
                     .OrderByDescending(item => item.frame.Score))
        {
            if (CanDecode(frame))
            {
                return index;
            }
        }

        throw new InvalidDataException("ICO contains no decodable images.");
    }

    public bool CanDecode(IcoFrame frame)
    {
        try
        {
            using Bitmap bitmap = Decode(frame);
            return bitmap.Width == frame.Width && bitmap.Height == frame.Height;
        }
        catch (Exception ex) when (IsDecodeFailure(ex))
        {
            return false;
        }
    }

    public Bitmap Decode(IcoFrame frame)
    {
        if (frame.IsPng)
        {
            using var stream = new MemoryStream(
                data, frame.DataOffset, frame.DataLength, writable: false);
            using var decoded = new Bitmap(stream);
            return new Bitmap(decoded);
        }

        using MemoryStream singleIcon = BuildSingleEntryIcon(frame);
        using var icon = new Icon(singleIcon);
        using Bitmap decodedIcon = icon.ToBitmap();
        return new Bitmap(decodedIcon);
    }

    private MemoryStream BuildSingleEntryIcon(IcoFrame frame)
    {
        var output = new MemoryStream(22 + frame.DataLength);
        using var writer = new BinaryWriter(output, System.Text.Encoding.UTF8, leaveOpen: true);
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)1);
        writer.Write((byte)(frame.Width == 256 ? 0 : frame.Width));
        writer.Write((byte)(frame.Height == 256 ? 0 : frame.Height));
        writer.Write(frame.ColorCount);
        writer.Write(frame.Reserved);
        writer.Write(frame.Planes);
        writer.Write(frame.BitCount);
        writer.Write((uint)frame.DataLength);
        writer.Write((uint)22);
        writer.Write(data, frame.DataOffset, frame.DataLength);
        writer.Flush();
        output.Position = 0;
        return output;
    }

    private static bool IsDecodeFailure(Exception ex) =>
        ex is ArgumentException
            or ExternalException
            or OutOfMemoryException
            or EndOfStreamException
            or InvalidDataException;
}

internal static class IcoDecoder
{
    private const int MaxEntries = 1024;
    private const int MaxImageBytes = 32 * 1024 * 1024;
    private const int MaxBufferedInputBytes = 64 * 1024 * 1024;

    public static IcoDocument Read(Stream input)
    {
        ArgumentNullException.ThrowIfNull(input);
        byte[] data = ReadInput(input);
        IReadOnlyList<IcoFrame> frames = ReadDirectory(data);
        return new IcoDocument(data, frames);
    }

    private static byte[] ReadInput(Stream input)
    {
        var output = new MemoryStream();
        byte[] buffer = new byte[81920];
        int total = 0;

        while (true)
        {
            int read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;

            total = checked(total + read);
            if (total > MaxBufferedInputBytes)
            {
                throw new InvalidDataException("ICO input is too large to buffer safely.");
            }

            output.Write(buffer, 0, read);
        }

        return output.ToArray();
    }

    private static IReadOnlyList<IcoFrame> ReadDirectory(byte[] data)
    {
        if (data.Length < 6)
        {
            throw new InvalidDataException("ICO header is truncated.");
        }

        ReadOnlySpan<byte> header = data.AsSpan(0, 6);
        if (BinaryPrimitives.ReadUInt16LittleEndian(header) != 0 ||
            BinaryPrimitives.ReadUInt16LittleEndian(header[2..]) != 1)
        {
            throw new InvalidDataException("Not a valid Windows icon file.");
        }

        int count = BinaryPrimitives.ReadUInt16LittleEndian(header[4..]);
        if (count <= 0 || count > MaxEntries)
        {
            throw new InvalidDataException("ICO directory entry count is invalid.");
        }

        int directoryLength = checked(count * 16);
        if (data.Length < 6 + directoryLength)
        {
            throw new InvalidDataException("ICO directory is truncated.");
        }

        int minimumDataOffset = 6 + directoryLength;
        var frames = new List<IcoFrame>(count);

        for (int index = 0; index < count; index++)
        {
            int offset = 6 + (index * 16);
            ReadOnlySpan<byte> entry = data.AsSpan(offset, 16);
            int width = entry[0] == 0 ? 256 : entry[0];
            int height = entry[1] == 0 ? 256 : entry[1];
            uint rawLength = BinaryPrimitives.ReadUInt32LittleEndian(entry[8..12]);
            uint rawOffset = BinaryPrimitives.ReadUInt32LittleEndian(entry[12..16]);

            if (rawLength == 0 || rawLength > MaxImageBytes || rawOffset > int.MaxValue)
            {
                continue;
            }

            int dataLength = checked((int)rawLength);
            int dataOffset = checked((int)rawOffset);
            if (dataOffset < minimumDataOffset || dataOffset > data.Length - dataLength)
            {
                continue;
            }

            frames.Add(new IcoFrame(
                index,
                width,
                height,
                entry[2],
                entry[3],
                BinaryPrimitives.ReadUInt16LittleEndian(entry[4..6]),
                BinaryPrimitives.ReadUInt16LittleEndian(entry[6..8]),
                dataLength,
                dataOffset,
                IsPng(data, dataOffset, dataLength)));
        }

        if (frames.Count == 0)
        {
            throw new InvalidDataException("ICO contains no readable directory entries.");
        }

        return frames;
    }

    private static bool IsPng(byte[] data, int offset, int length)
    {
        ReadOnlySpan<byte> signature = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
        return length >= signature.Length &&
               data.AsSpan(offset, signature.Length).SequenceEqual(signature);
    }
}
