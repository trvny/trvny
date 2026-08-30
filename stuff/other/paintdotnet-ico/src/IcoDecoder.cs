using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace Travny.PaintDotNetIco;

internal static class IcoDecoder
{
    private const int MaxEntries = 1024;
    private const int MaxImageBytes = 32 * 1024 * 1024;
    private const long MaxBufferedInputBytes = 64L * 1024 * 1024;

    public static Bitmap ReadLargestBitmap(Stream input)
    {
        ArgumentNullException.ThrowIfNull(input);

        if (!input.CanSeek)
        {
            using MemoryStream buffered = BufferNonSeekable(input);
            return ReadLargestBitmap(buffered);
        }

        List<IcoEntry> entries = ReadDirectory(input);
        foreach (IcoEntry entry in entries.OrderByDescending(static entry => entry.Score))
        {
            try
            {
                using MemoryStream singleIcon = BuildSingleEntryIcon(input, entry);
                using var icon = new Icon(singleIcon);
                return icon.ToBitmap();
            }
            catch (Exception ex) when (ex is ArgumentException or ExternalException or OutOfMemoryException or EndOfStreamException)
            {
                // Try the next-best frame if this entry is malformed.
            }
        }

        throw new InvalidDataException("ICO contains no decodable images.");
    }

    private static MemoryStream BufferNonSeekable(Stream input)
    {
        var output = new MemoryStream();
        byte[] buffer = new byte[81920];
        long total = 0;

        while (true)
        {
            int read = input.Read(buffer, 0, buffer.Length);
            if (read == 0)
                break;

            total += read;
            if (total > MaxBufferedInputBytes)
                throw new InvalidDataException("ICO input is too large to buffer safely.");

            output.Write(buffer, 0, read);
        }

        output.Position = 0;
        return output;
    }

    private static List<IcoEntry> ReadDirectory(Stream input)
    {
        input.Position = 0;
        Span<byte> header = stackalloc byte[6];
        input.ReadExactly(header);

        if (BinaryPrimitives.ReadUInt16LittleEndian(header) != 0 ||
            BinaryPrimitives.ReadUInt16LittleEndian(header[2..]) != 1)
            throw new InvalidDataException("Not a valid Windows icon file.");

        int count = BinaryPrimitives.ReadUInt16LittleEndian(header[4..]);
        if (count <= 0 || count > MaxEntries)
            throw new InvalidDataException("ICO directory entry count is invalid.");

        int directoryLength = checked(count * 16);
        byte[] directory = new byte[directoryLength];
        input.ReadExactly(directory);
        long minimumDataOffset = 6L + directoryLength;
        long streamLength = input.Length;
        var entries = new List<IcoEntry>(count);

        for (int i = 0; i < count; i++)
        {
            int offset = i * 16;
            int width = directory[offset] == 0 ? 256 : directory[offset];
            int height = directory[offset + 1] == 0 ? 256 : directory[offset + 1];
            uint rawDataLength = BinaryPrimitives.ReadUInt32LittleEndian(directory.AsSpan(offset + 8, 4));
            if (rawDataLength == 0 || rawDataLength > MaxImageBytes)
                continue;
            int dataLength = (int)rawDataLength;
            long dataOffset = BinaryPrimitives.ReadUInt32LittleEndian(directory.AsSpan(offset + 12, 4));

            if (dataOffset < minimumDataOffset || dataOffset > streamLength - dataLength)
                continue;

            entries.Add(new IcoEntry(
                width,
                height,
                directory[offset + 2],
                directory[offset + 3],
                BinaryPrimitives.ReadUInt16LittleEndian(directory.AsSpan(offset + 4, 2)),
                BinaryPrimitives.ReadUInt16LittleEndian(directory.AsSpan(offset + 6, 2)),
                dataLength,
                dataOffset));
        }

        if (entries.Count == 0)
            throw new InvalidDataException("ICO contains no readable directory entries.");

        return entries;
    }

    private static MemoryStream BuildSingleEntryIcon(Stream input, IcoEntry entry)
    {
        var output = new MemoryStream(22 + entry.DataLength);
        using var writer = new BinaryWriter(output, System.Text.Encoding.UTF8, leaveOpen: true);
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)1);
        writer.Write((byte)(entry.Width == 256 ? 0 : entry.Width));
        writer.Write((byte)(entry.Height == 256 ? 0 : entry.Height));
        writer.Write(entry.ColorCount);
        writer.Write(entry.Reserved);
        writer.Write(entry.Planes);
        writer.Write(entry.BitCount);
        writer.Write((uint)entry.DataLength);
        writer.Write((uint)22);
        writer.Flush();

        input.Position = entry.DataOffset;
        CopyExactly(input, output, entry.DataLength);
        output.Position = 0;
        return output;
    }

    private static void CopyExactly(Stream input, Stream output, int bytesToCopy)
    {
        byte[] buffer = new byte[Math.Min(81920, bytesToCopy)];
        int remaining = bytesToCopy;
        while (remaining > 0)
        {
            int read = input.Read(buffer, 0, Math.Min(buffer.Length, remaining));
            if (read == 0)
                throw new EndOfStreamException();
            output.Write(buffer, 0, read);
            remaining -= read;
        }
    }

    private readonly record struct IcoEntry(
        int Width,
        int Height,
        byte ColorCount,
        byte Reserved,
        ushort Planes,
        ushort BitCount,
        int DataLength,
        long DataOffset)
    {
        public long Score => ((long)Width * Height << 16) + BitCount;
    }
}
