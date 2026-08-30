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
    long DataOffset,
    bool IsPng)
{
    public long Score => ((long)Width * Height << 16) + BitCount;
}

internal sealed class IcoDocument : IDisposable
{
    private readonly Stream input;
    private readonly bool ownsInput;

    public IcoDocument(Stream input, IReadOnlyList<IcoFrame> frames, bool ownsInput)
    {
        this.input = input;
        this.ownsInput = ownsInput;
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
            byte[] payload = ReadPayload(frame);
            using var stream = new MemoryStream(payload, writable: false);
            using var decoded = new Bitmap(stream);
            return new Bitmap(decoded);
        }

        using MemoryStream singleIcon = BuildSingleEntryIcon(frame);
        using var icon = new Icon(singleIcon);
        using Bitmap decodedIcon = icon.ToBitmap();
        return new Bitmap(decodedIcon);
    }

    private byte[] ReadPayload(IcoFrame frame)
    {
        byte[] payload = new byte[frame.DataLength];
        input.Position = frame.DataOffset;
        input.ReadExactly(payload);
        return payload;
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
        writer.Flush();

        input.Position = frame.DataOffset;
        CopyExactly(input, output, frame.DataLength);
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
            {
                throw new EndOfStreamException();
            }

            output.Write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static bool IsDecodeFailure(Exception ex) =>
        ex is ArgumentException
            or ExternalException
            or OutOfMemoryException
            or EndOfStreamException
            or InvalidDataException;

    public void Dispose()
    {
        if (ownsInput)
        {
            input.Dispose();
        }
    }
}

internal static class IcoDecoder
{
    private const int MaxEntries = 1024;
    private const int MaxImageBytes = 32 * 1024 * 1024;
    private const long MaxBufferedInputBytes = 64L * 1024 * 1024;
    public static IcoDocument Read(Stream input)
    {
        ArgumentNullException.ThrowIfNull(input);

        if (input.CanSeek)
        {
            return CreateDocument(input, ownsInput: false);
        }

        MemoryStream buffered = BufferNonSeekable(input);
        try
        {
            return CreateDocument(buffered, ownsInput: true);
        }
        catch
        {
            buffered.Dispose();
            throw;
        }
    }

    private static IcoDocument CreateDocument(Stream input, bool ownsInput)
    {
        IReadOnlyList<IcoFrame> frames = ReadDirectory(input);
        return new IcoDocument(input, frames, ownsInput);
    }

    private static MemoryStream BufferNonSeekable(Stream input)
    {
        var output = new MemoryStream();
        byte[] buffer = new byte[81920];
        long total = 0;

        while (true)
        {
            int read = input.Read(buffer, 0, buffer.Length);
            if (read == 0) break;

            total += read;
            if (total > MaxBufferedInputBytes)
            {
                output.Dispose();
                throw new InvalidDataException("ICO input is too large to buffer safely.");
            }

            output.Write(buffer, 0, read);
        }

        output.Position = 0;
        return output;
    }

    private static IReadOnlyList<IcoFrame> ReadDirectory(Stream input)
    {
        input.Position = 0;
        Span<byte> header = stackalloc byte[6];
        input.ReadExactly(header);

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
        byte[] directory = new byte[directoryLength];
        input.ReadExactly(directory);
        long minimumDataOffset = 6L + directoryLength;
        long streamLength = input.Length;
        var frames = new List<IcoFrame>(count);

        for (int index = 0; index < count; index++)
        {
            int offset = index * 16;
            ReadOnlySpan<byte> entry = directory.AsSpan(offset, 16);
            int width = entry[0] == 0 ? 256 : entry[0];
            int height = entry[1] == 0 ? 256 : entry[1];
            uint rawLength = BinaryPrimitives.ReadUInt32LittleEndian(entry[8..12]);
            uint rawOffset = BinaryPrimitives.ReadUInt32LittleEndian(entry[12..16]);

            if (rawLength == 0 || rawLength > MaxImageBytes)
            {
                continue;
            }

            int dataLength = checked((int)rawLength);
            long dataOffset = rawOffset;
            if (dataOffset < minimumDataOffset || dataOffset > streamLength - dataLength)
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
                IsPng(input, dataOffset, dataLength)));
        }

        if (frames.Count == 0)
        {
            throw new InvalidDataException("ICO contains no readable directory entries.");
        }

        return frames;
    }
    private static bool IsPng(Stream input, long offset, int length)
    {
        if (length < 8)
        {
            return false;
        }

        Span<byte> signature = stackalloc byte[8];
        input.Position = offset;
        input.ReadExactly(signature);
        ReadOnlySpan<byte> pngSignature = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
        return signature.SequenceEqual(pngSignature);
    }
}
