using Feedboard.Models;
using System.Text.Json;

namespace Feedboard.Services;

public sealed class FeedStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public FeedStore(string? path = null)
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Feedboard");
        _path = path ?? Path.Combine(root, "feeds.json");
    }

    public async Task<IReadOnlyList<FeedSource>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path))
            {
                return Array.Empty<FeedSource>();
            }

            await using var stream = File.OpenRead(_path);
            return await JsonSerializer.DeserializeAsync<List<FeedSource>>(stream, JsonOptions, cancellationToken)
                ?? new List<FeedSource>();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task AddAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            throw new ArgumentException("Feed URL must be an absolute HTTP(S) URL.", nameof(url));
        }

        await MergeAsync(new[] { new FeedSource(uri.ToString()) }, cancellationToken);
    }

    public async Task MergeAsync(IEnumerable<FeedSource> incoming, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = new List<FeedSource>();
            if (File.Exists(_path))
            {
                await using var read = File.OpenRead(_path);
                current = await JsonSerializer.DeserializeAsync<List<FeedSource>>(read, JsonOptions, cancellationToken) ?? new();
            }

            var byUrl = current.ToDictionary(x => x.Url, StringComparer.OrdinalIgnoreCase);
            foreach (var source in incoming)
            {
                if (!Uri.TryCreate(source.Url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
                {
                    continue;
                }

                byUrl[source.Url] = source;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            await using var write = File.Create(_path);
            await JsonSerializer.SerializeAsync(write, byUrl.Values.OrderBy(x => x.Title ?? x.Url).ToList(), JsonOptions, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }
}
