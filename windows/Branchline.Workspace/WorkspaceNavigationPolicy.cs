using System;

namespace Branchline.Workspace;

/// <summary>
/// Isolated HTTPS staging only. The hosted app/Edge Functions own authentication.
/// The Windows preview must not open production Branchline/PTG links inside its
/// staging WebView2 browser profile or capture unrelated staging routes.
/// </summary>
public static class WorkspaceNavigationPolicy
{
    public const string HomeUrl = "https://branchline-staging.github.io/";
    private const string StagingHost = "branchline-staging.github.io";

    private static readonly string[] AllowedAppPaths =
    {
        "/sales-tracker/",
        "/first-megasaver-ptg/",
        "/megaframe-studio/studio/",
        "/flyer-studio/studio/"
    };

    public static bool IsInternalAppUrl(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var destination))
            return false;
        if (destination.Scheme != Uri.UriSchemeHttps ||
            destination.Port != 443 ||
            !destination.Host.Equals(StagingHost, StringComparison.OrdinalIgnoreCase) ||
            destination.UserInfo.Length != 0)
            return false;

        if (destination.AbsolutePath == "/") return true;

        foreach (var prefix in AllowedAppPaths)
            if (destination.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal))
                return true;
        return false;
    }
}
