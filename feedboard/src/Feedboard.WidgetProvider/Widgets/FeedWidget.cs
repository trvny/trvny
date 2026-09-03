using Feedboard.Models;
using Feedboard.Services;
using Microsoft.Windows.Widgets.Providers;
using System.Text.Json;

namespace Feedboard.Widgets;

public sealed class FeedWidget : IDisposable
{
    public const string DefinitionId = "Feedboard_Headlines";

    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(15);
    private readonly string _id;
    private readonly FeedStore _store = new();
    private readonly FeedClient _client = new();
    private readonly SemaphoreSlim _refreshGate = new(1, 1);

    private IReadOnlyList<FeedArticle> _articles = Array.Empty<FeedArticle>();
    private WidgetState _state;
    private Timer? _timer;
    private DateTimeOffset _updatedAt = DateTimeOffset.Now;
    private bool _disposed;

    public FeedWidget(string id, string customState)
    {
        _id = id;
        _state = ParseState(customState);
    }

    public void Activate()
    {
        if (_disposed)
        {
            return;
        }

        _timer ??= new Timer(_ => _ = RefreshAsync(), null, TimeSpan.Zero, RefreshInterval);
    }

    public void Deactivate()
    {
        _timer?.Dispose();
        _timer = null;
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || !await _refreshGate.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            var sources = await _store.LoadAsync(cancellationToken);
            _articles = await _client.LoadAsync(sources, cancellationToken);
            _updatedAt = DateTimeOffset.Now;

            if (_state.ExpandedArticleId is not null && _articles.All(x => x.Id != _state.ExpandedArticleId))
            {
                _state = new WidgetState();
            }

            PushCurrentCard();
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    public void OnActionInvoked(WidgetActionInvokedArgs args)
    {
        const string expandPrefix = "expand:";
        if (!args.Verb.StartsWith(expandPrefix, StringComparison.Ordinal))
        {
            return;
        }

        var articleId = args.Verb[expandPrefix.Length..];
        if (_articles.Any(x => x.Id == articleId))
        {
            _state = new WidgetState(articleId);
            PushCurrentCard();
        }
    }

    public void PushCurrentCard()
    {
        if (_disposed)
        {
            return;
        }

        var options = new WidgetUpdateRequestOptions(_id)
        {
            Template = WidgetCardRenderer.Render(_articles, _state, _updatedAt),
            Data = "{}",
            CustomState = JsonSerializer.Serialize(_state)
        };

        WidgetManager.GetDefault().UpdateWidget(options);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _timer?.Dispose();
        _refreshGate.Dispose();
    }

    private static WidgetState ParseState(string customState)
    {
        if (string.IsNullOrWhiteSpace(customState))
        {
            return new WidgetState();
        }

        try
        {
            return JsonSerializer.Deserialize<WidgetState>(customState) ?? new WidgetState();
        }
        catch (JsonException)
        {
            return new WidgetState();
        }
    }
}
