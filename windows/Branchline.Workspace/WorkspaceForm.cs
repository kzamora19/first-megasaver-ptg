using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Branchline.Workspace;

internal sealed class WorkspaceForm : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly ToolStripButton back = new("Back");
    private readonly ToolStripButton forward = new("Forward");
    private readonly ToolStripButton reload = new("Reload");
    private readonly ToolStripButton home = new("Home");
    private readonly ToolStripButton external = new("Open in browser");

    public WorkspaceForm()
    {
        Text = "Branchline Workspace Preview";
        Width = 1280;
        Height = 820;
        MinimumSize = new System.Drawing.Size(380, 500);
        StartPosition = FormStartPosition.CenterScreen;

        var tools = new ToolStrip
        {
            Dock = DockStyle.Top,
            GripStyle = ToolStripGripStyle.Hidden
        };
        tools.Items.AddRange(new ToolStripItem[]
        {
            back, forward, reload, new ToolStripSeparator(), home,
            new ToolStripSeparator(), external
        });
        Controls.Add(browser);
        Controls.Add(tools);

        back.Click += (_, _) => { if (browser.CanGoBack) browser.GoBack(); };
        forward.Click += (_, _) => { if (browser.CanGoForward) browser.GoForward(); };
        reload.Click += (_, _) => browser.CoreWebView2?.Reload();
        home.Click += (_, _) => browser.CoreWebView2?.Navigate(WorkspaceNavigationPolicy.HomeUrl);
        external.Click += (_, _) => OpenExternal(browser.Source?.ToString() ?? WorkspaceNavigationPolicy.HomeUrl);
        Shown += async (_, _) => await StartBrowserAsync();
        RefreshButtons();
    }

    private async Task StartBrowserAsync()
    {
        try
        {
            // Separate preview profile. Never migrate or clear a user's existing
            // production WebView2/browser profile during this release candidate.
            var profile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Branchline", "WorkspacePreview", "WebView2");
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            await browser.EnsureCoreWebView2Async(environment);

            browser.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                // Only real app routes remain in the unified window. Unrelated
                // popups (including provider consent) retain WebView2 behavior.
                if (!WorkspaceNavigationPolicy.IsInternalAppUrl(args.Uri))
                    return;
                args.Handled = true;
                browser.CoreWebView2.Navigate(args.Uri);
            };
            browser.NavigationCompleted += (_, _) => RefreshButtons();
            browser.CoreWebView2.HistoryChanged += (_, _) => RefreshButtons();
            browser.CoreWebView2.DocumentTitleChanged += (_, _) =>
            {
                var title = browser.CoreWebView2.DocumentTitle;
                Text = string.IsNullOrWhiteSpace(title)
                    ? "Branchline Workspace Preview"
                    : title + " — Branchline Workspace Preview";
            };
            browser.CoreWebView2.Navigate(WorkspaceNavigationPolicy.HomeUrl);
            RefreshButtons();
        }
        catch (Exception ex)
        {
            var choice = MessageBox.Show(
                this,
                "Branchline Workspace Preview could not start its embedded browser.\n\n" +
                "Install or repair Microsoft Edge WebView2 Runtime, then reopen this preview.\n\n" +
                "Technical detail: " + ex.GetType().Name + "\n\nOpen Microsoft's WebView2 page?",
                "Workspace browser unavailable",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (choice == DialogResult.Yes)
                OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
        }
    }

    private void RefreshButtons()
    {
        back.Enabled = browser.CanGoBack;
        forward.Enabled = browser.CanGoForward;
        reload.Enabled = browser.CoreWebView2 != null;
        home.Enabled = browser.CoreWebView2 != null;
    }

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var destination) ||
            (destination.Scheme != Uri.UriSchemeHttps &&
             destination.Scheme != Uri.UriSchemeHttp))
            return;
        try
        {
            Process.Start(new ProcessStartInfo(destination.AbsoluteUri)
            {
                UseShellExecute = true
            });
        }
        catch (Exception)
        {
            MessageBox.Show("Could not open the system browser.", "Branchline Workspace",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
