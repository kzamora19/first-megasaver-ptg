using System;

namespace Branchline.Workspace;

/// <summary>
/// Only the official same-host Branchline and PTG/Studio application routes are
/// folded into the existing WebView2 window. Authentication is enforced by
/// the hosted apps and Edge Functions, never by this URL selection helper.
/// </summary>
public static class WorkspaceNavigationPolicy
{
    public const string HomeUrl = "https://kzamora19.github.io/branchline/apps/";
    private const string OfficialHost = "kzamora19.github.io";

    private static readonly string[] AllowedAppPaths =
    {
        "/branchline/",
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
            !destination.Host.Equals(OfficialHost, StringComparison.OrdinalIgnoreCase) ||
            destination.UserInfo.Length != 0)
            return false;

        foreach (var prefix in AllowedAppPaths)
            if (destination.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal))
                return true;
        return false;
    }
}
