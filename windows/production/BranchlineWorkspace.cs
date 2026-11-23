using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: CompilationRelaxations(8)]
[assembly: RuntimeCompatibility(WrapNonExceptionThrows = true)]
[assembly: AssemblyVersion("0.0.0.0")]
internal sealed class BranchlineWorkspace : Form
{
	private sealed class WorkspaceLoadingScreen : Control
	{
		private static readonly RectangleF[] LogoBars = new RectangleF[3]
		{
			new RectangleF(124f, 267f, 56f, 133f),
			new RectangleF(228f, 164f, 56f, 236f),
			new RectangleF(332f, 306f, 56f, 94f)
		};

		private readonly Timer animation = new Timer
		{
			Interval = 35
		};

		private readonly Stopwatch motion = new Stopwatch();

		private string studioName;

		private int target = 65;

		internal int Progress { get; private set; }

		internal WorkspaceLoadingScreen()
		{
			BackColor = Color.FromArgb(245, 246, 248);
			base.AccessibleName = "Branchline Workspace loading";
			DoubleBuffered = true;
			base.ResizeRedraw = true;
			Timer timer = animation;
			EventHandler value = delegate
			{
				if (Progress < target)
				{
					Progress += Math.Max(1, (target - Progress) / 10);
				}
				Invalidate();
			};
			timer.Tick += value;
		}

		internal void ShowStudio(string name, bool editorReached)
		{
			if (studioName != name)
			{
				Progress = 0;
			}
			studioName = name;
			target = (editorReached ? 94 : 65);
			Invalidate();
		}

		protected override void OnVisibleChanged(EventArgs e)
		{
			base.OnVisibleChanged(e);
			if (base.Visible)
			{
				motion.Restart();
				animation.Start();
				return;
			}
			animation.Stop();
			motion.Reset();
			studioName = null;
			Progress = 0;
		}

		protected override void OnPaint(PaintEventArgs e)
		{
			base.OnPaint(e);
			Graphics graphics = e.Graphics;
			graphics.SmoothingMode = SmoothingMode.AntiAlias;
			float num = (float)base.DeviceDpi / 96f;
			float num2 = Math.Min(300f * num, (float)base.ClientSize.Width * 0.8f);
			float x = ((float)base.ClientSize.Width - num2) / 2f;
			float num3 = ((float)base.ClientSize.Height - 184f * num) / 2f;
			DrawAnimatedLogo(graphics, num3, num, motion.Elapsed.TotalSeconds);
			RectangleF bounds = new RectangleF(x, num3 + 104f * num, num2, 11f * num);
			using (SolidBrush brush = new SolidBrush(Color.FromArgb(231, 237, 253)))
			{
				using GraphicsPath path = RoundedBar(bounds);
				graphics.FillPath(brush, path);
			}
			if (Progress > 0)
			{
				RectangleF rectangleF = new RectangleF(bounds.X, bounds.Y, bounds.Width * (float)Progress / 100f, bounds.Height);
				using GraphicsPath path2 = RoundedBar(rectangleF);
				using LinearGradientBrush brush2 = new LinearGradientBrush(rectangleF, Color.FromArgb(53, 94, 232), Color.FromArgb(115, 150, 255), LinearGradientMode.Horizontal);
				graphics.FillPath(brush2, path2);
			}
			using Font font = new Font("Segoe UI", 15f, FontStyle.Bold);
			using Font font2 = new Font("Segoe UI", 9f);
			TextFormatFlags flags = TextFormatFlags.EndEllipsis | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter;
			TextRenderer.DrawText(graphics, Progress + "%", font, new Rectangle(0, (int)(num3 + 129f * num), base.ClientSize.Width, (int)(26f * num)), Color.FromArgb(53, 94, 232), flags);
			string text = ((studioName == null) ? "OPENING BRANCHLINE WORKSPACE…" : ("OPENING " + studioName.ToUpperInvariant() + "…"));
			TextRenderer.DrawText(graphics, text, font2, new Rectangle(0, (int)(num3 + 165f * num), base.ClientSize.Width, (int)(22f * num)), Color.FromArgb(88, 107, 137), flags);
		}

		private void DrawAnimatedLogo(Graphics graphics, float top, float scale, double seconds)
		{
			float num = 84f * scale;
			GraphicsState gstate = graphics.Save();
			graphics.TranslateTransform(((float)base.ClientSize.Width - num) / 2f, top - 6f * scale * Pulse(seconds, 1.6));
			graphics.ScaleTransform(num / 512f, num / 512f);
			using (SolidBrush brush = new SolidBrush(Color.FromArgb(53, 94, 232)))
			{
				using GraphicsPath path = RoundedRectangle(new RectangleF(0f, 0f, 512f, 512f), 112f);
				graphics.FillPath(brush, path);
			}
			for (int i = 0; i < LogoBars.Length; i++)
			{
				RectangleF rectangleF = LogoBars[i];
				float num2 = 0.45f + 0.65f * Pulse(seconds - (double)i * 0.15, 1.1);
				float num3 = rectangleF.Height * num2;
				using GraphicsPath path2 = RoundedRectangle(new RectangleF(rectangleF.X, rectangleF.Bottom - num3, rectangleF.Width, num3), 20f);
				graphics.FillPath(Brushes.White, path2);
			}
			graphics.Restore(gstate);
		}

		private static float Pulse(double seconds, double period)
		{
			return (seconds <= 0.0) ? 0f : ((float)((1.0 - Math.Cos(Math.PI * 2.0 * seconds / period)) / 2.0));
		}

		private static GraphicsPath RoundedRectangle(RectangleF rect, float radius)
		{
			float num = Math.Min(radius * 2f, Math.Min(rect.Width, rect.Height));
			GraphicsPath graphicsPath = new GraphicsPath();
			graphicsPath.AddArc(rect.X, rect.Y, num, num, 180f, 90f);
			graphicsPath.AddArc(rect.Right - num, rect.Y, num, num, 270f, 90f);
			graphicsPath.AddArc(rect.Right - num, rect.Bottom - num, num, num, 0f, 90f);
			graphicsPath.AddArc(rect.X, rect.Bottom - num, num, num, 90f, 90f);
			graphicsPath.CloseFigure();
			return graphicsPath;
		}

		private static GraphicsPath RoundedBar(RectangleF bounds)
		{
			float num = Math.Min(bounds.Width, bounds.Height);
			GraphicsPath graphicsPath = new GraphicsPath();
			graphicsPath.AddArc(bounds.X, bounds.Y, num, bounds.Height, 90f, 180f);
			graphicsPath.AddArc(bounds.Right - num, bounds.Y, num, bounds.Height, 270f, 180f);
			graphicsPath.CloseFigure();
			return graphicsPath;
		}

		protected override void Dispose(bool disposing)
		{
			if (disposing)
			{
				animation.Dispose();
			}
			base.Dispose(disposing);
		}
	}

	private sealed class RailTab : Button
	{
		private readonly Image icon;

		private readonly string shortLabel;

		internal bool Selected { get; set; }

		internal RailTab(string label, string shortLabel, string asset)
		{
			Text = label;
			base.AccessibleName = label;
			this.shortLabel = shortLabel;
			using (Stream stream = typeof(BranchlineWorkspace).Assembly.GetManifestResourceStream("Approved." + asset + ".png"))
			{
				using Image original = Image.FromStream(stream);
				icon = new Bitmap(original);
			}
			Dock = DockStyle.Fill;
			base.Margin = new Padding(0, 2, 1, 2);
			Cursor = Cursors.Hand;
			Font = new Font("Segoe UI", 10f, FontStyle.Bold);
			base.FlatStyle = FlatStyle.Flat;
			SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, value: true);
		}

		protected override void OnPaint(PaintEventArgs e)
		{
			Graphics graphics = e.Graphics;
			graphics.Clear(Navy);
			if (Width < 3 || Height < 3) return;
			graphics.SmoothingMode = SmoothingMode.AntiAlias;
			graphics.CompositingQuality = CompositingQuality.HighQuality;
			graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
			graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
			if (Selected || (Focused && ShowFocusCues))
			{
				using Pen pen = new Pen((Focused && ShowFocusCues) ? Cyan : Color.FromArgb(38, 185, 213), 1.5f);
				graphics.DrawRectangle(pen, 1.5f, 1.5f, Width - 3f, Height - 3f);
			}
			// Draw the COMPLETE 360px icon; the source PNGs have already had their
			// white matte removed. Never crop or clip their text or rounded corners.
			int inset = Math.Max(4, (int)Math.Ceiling((double)DeviceDpi / 96 * 5));
			int size = Math.Max(0, Math.Min(Height - 2 * inset, Width - 2 * inset));
			if (size > 0)
			{
				Rectangle destination = new Rectangle((Width - size) / 2, (Height - size) / 2, size, size);
				graphics.DrawImage(icon, destination, 0, 0, icon.Width, icon.Height, GraphicsUnit.Pixel);
			}
		}

	}

	private const string Origin = "https://kzamora19.github.io";

	private const string SalesPath = "/branchline/";

	private const string PtgPath = "/first-megasaver-ptg/";

	private const string DeskPath = "/first-megasaver-ptg/data-desk/";

	private const string StudiosPath = "/first-megasaver-ptg/studios/";

	private const string MegaFramePath = "/megaframe-studio/studio/";

	private const string MegaFlyerPath = "/flyer-studio/studio/";

	private static readonly Color Navy = Color.FromArgb(16, 43, 77);

	private static readonly Color Cyan = Color.FromArgb(103, 222, 238);

	private readonly WebView2 sales = new WebView2();

	private readonly WebView2 ptg = new WebView2();

	private readonly WebView2 megaFrame = new WebView2();

	private readonly WebView2 megaFlyer = new WebView2();

	private readonly HashSet<WebView2> requestedStudioLaunches = new HashSet<WebView2>();

	private readonly HashSet<WebView2> loadingStudios = new HashSet<WebView2>();

	private readonly HashSet<WebView2> authorizingEditors = new HashSet<WebView2>();

	private readonly TableLayoutPanel shell = new TableLayoutPanel();

	private readonly TableLayoutPanel rail = new TableLayoutPanel();

	private readonly Panel stage = new Panel();

	private readonly RailTab menu = new RailTab("Toggle current application workspace menu", "", "branchline");

	private readonly Label status = new Label();

	private readonly WorkspaceLoadingScreen loadingScreen;

	private readonly Timer sessionWatch = new Timer
	{
		Interval = 1800
	};

	private readonly RailTab[] tabs;

	private readonly Image wordmark;

	private readonly Image megasaverHeaderImage;

	private readonly Image brandWordartImage;

	private readonly PictureBox megasaverHeader = new PictureBox();

	private readonly Label activeTitle = new Label();

	private readonly PictureBox brandWordart = new PictureBox();

	private string frameScript;

	private readonly string themeScript;

	private readonly string salesImportScript;

	private readonly string studioMenuScript;

	private readonly Dictionary<WebView2, List<CoreWebView2Frame>> studioFrames = new Dictionary<WebView2, List<CoreWebView2Frame>>();

	private bool ready;

	private bool deskAllowed;

	private bool menuOpen;

	private bool checking;

	private bool refreshing;

	private bool? narrowLayout;

	private string lastMenuState;

	private int selected;

	private int selectionRevision;

	private Uri lastPtgPage = new Uri("https://kzamora19.github.io/first-megasaver-ptg/dashboard/");

	private int exitCode;

	private readonly bool verify;

	private readonly bool verifyShell;

	private string trustedHost = "kzamora19.github.io";

	[STAThread]
	private static int Main(string[] args)
	{
		Application.EnableVisualStyles();
		Application.SetCompatibleTextRenderingDefault(defaultValue: false);
		using BranchlineWorkspace branchlineWorkspace = new BranchlineWorkspace(Array.IndexOf(args, "--verify") >= 0, Array.IndexOf(args, "--verify-shell") >= 0);
		Application.Run(branchlineWorkspace);
		return branchlineWorkspace.exitCode;
	}

	private BranchlineWorkspace(bool verify, bool verifyShell)
	{
		this.verify = verify || verifyShell;
		this.verifyShell = verifyShell;
		Text = "Branchline Workspace";
		base.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
		loadingScreen = new WorkspaceLoadingScreen
		{
			Dock = DockStyle.Fill
		};
		BackColor = Navy;
		base.StartPosition = FormStartPosition.CenterScreen;
		base.ClientSize = new Size(1140, 730);
		MinimumSize = new Size(400, 455);
		base.AutoScaleMode = AutoScaleMode.Dpi;
		if (this.verify)
		{
			base.ShowInTaskbar = false;
			base.StartPosition = FormStartPosition.Manual;
			base.Location = new Point(-20000, -20000);
		}
		Assembly executingAssembly = Assembly.GetExecutingAssembly();
		using (Stream stream = executingAssembly.GetManifestResourceStream("BranchlineWordmark.png"))
		{
			using Image original = Image.FromStream(stream);
			wordmark = new Bitmap(original);
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("BranchlineWordartFull.png"))
		{
			using Image original = Image.FromStream(stream);
			brandWordartImage = new Bitmap(original);
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("FirstMegasaverHeader.png"))
		{
			using Image original = Image.FromStream(stream);
			megasaverHeaderImage = new Bitmap(original);
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("DataDeskFrame.js"))
		{
			using StreamReader streamReader = new StreamReader(stream);
			frameScript = streamReader.ReadToEnd();
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("WorkspaceTheme.js"))
		{
			using StreamReader streamReader = new StreamReader(stream);
			using MemoryStream memoryStream = new MemoryStream();
			wordmark.Save(memoryStream, ImageFormat.Png);
			themeScript = streamReader.ReadToEnd().Replace("BRANCHLINE_WORDMARK", Convert.ToBase64String(memoryStream.ToArray()));
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("StudioWorkspaceMenu.js"))
		{
			using StreamReader streamReader = new StreamReader(stream);
			studioMenuScript = streamReader.ReadToEnd();
		}
		using (Stream stream = executingAssembly.GetManifestResourceStream("OpenSalesImport.js"))
		{
			using StreamReader streamReader = new StreamReader(stream);
			salesImportScript = streamReader.ReadToEnd();
		}
		// The outer navigation is a single solid-navy top strip. Native app selectors
		// are horizontal; the embedded app supplies its own role-aware workspace menu.
		shell.Dock = DockStyle.Fill;
		shell.ColumnCount = 2;
		shell.RowCount = 2;
		shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 0f));
		shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
		shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 94f));
		shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
		base.Controls.Add(shell);
		Panel panel = new Panel
		{
			Dock = DockStyle.Fill,
			Margin = Padding.Empty,
			Padding = new Padding(6, 5, 9, 5),
			BackColor = Navy
		};
		menu.Text = "";
		menu.AccessibleName = "Toggle current application workspace menu";
		menu.Size = new Size(86, 82);
		menu.Width = 86;
		menu.Dock = DockStyle.Left;
		menu.ForeColor = Color.White;
		menu.BackColor = Navy;
		menu.FlatStyle = FlatStyle.Flat;
		menu.FlatAppearance.BorderSize = 0;
		menu.Click += delegate
		{
			menuOpen = !menuOpen;
			LayoutRail();
		};
		brandWordart.Image = brandWordartImage;
		brandWordart.BackColor = Navy;
		brandWordart.SizeMode = PictureBoxSizeMode.Zoom;
		brandWordart.Dock = DockStyle.Left;
		brandWordart.Width = 288;
		brandWordart.Padding = new Padding(5, 6, 12, 3);
		brandWordart.AccessibleName = "Branchline full wordmark, blue dot and cyan curved underline";
		Panel headingHost = new Panel { Dock = DockStyle.Fill, BackColor = Navy };
		megasaverHeader.Image = megasaverHeaderImage;
		megasaverHeader.SizeMode = PictureBoxSizeMode.Zoom;
		megasaverHeader.BackColor = Navy;
		megasaverHeader.Dock = DockStyle.Fill;
		megasaverHeader.AccessibleName = "1st Megasaver, Price Tag Generator";
		activeTitle.Dock = DockStyle.Fill;
		activeTitle.BackColor = Navy;
		activeTitle.ForeColor = Color.White;
		activeTitle.TextAlign = ContentAlignment.MiddleCenter;
		activeTitle.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
		headingHost.Controls.Add(activeTitle);
		headingHost.Controls.Add(megasaverHeader);
		// Four official applications only. Data Desk remains an internal PTG view,
		// still selected by the existing SYSTEM_ADMIN permission pathway.
		tabs = new RailTab[5]
		{
			new RailTab("Sales Tracker", "", "sales"),
			new RailTab("Price Tag Generator", "", "ptg"),
			new RailTab("Data Desk (PTG administration only)", "", "datadesk"),
			new RailTab("MegaFrame Studio", "", "megaframe"),
			new RailTab("MegaFlyer Studio", "", "megaflyer")
		};
		rail.Dock = DockStyle.Right;
		rail.BackColor = Navy;
		rail.Margin = Padding.Empty;
		rail.Padding = Padding.Empty;
		rail.Width = 354;
		rail.ColumnCount = 4;
		rail.RowCount = 1;
		rail.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
		for (int col = 0; col < 4; col++)
			rail.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25f));
		int[] appOrder = new int[4] { 1, 0, 3, 4 };
		for (int position = 0; position < appOrder.Length; position++)
		{
			int index = appOrder[position];
			tabs[index].Margin = new Padding(3, 4, 3, 4);
			tabs[index].Click += delegate { Select(index); };
			rail.Controls.Add(tabs[index], position, 0);
		}
		panel.Controls.Add(headingHost);
		panel.Controls.Add(rail);
		panel.Controls.Add(brandWordart);
		panel.Controls.Add(menu);
		shell.Controls.Add(panel, 0, 0);
		shell.SetColumnSpan(panel, 2);
		stage.Dock = DockStyle.Fill;
		stage.Margin = Padding.Empty;
		stage.BackColor = Navy;
		shell.Controls.Add(stage, 1, 1);
		WebView2[] array = new WebView2[4] { sales, ptg, megaFrame, megaFlyer };
		foreach (WebView2 webView in array)
		{
			webView.Dock = DockStyle.Fill;
			stage.Controls.Add(webView);
		}
		status.Dock = DockStyle.Fill;
		status.TextAlign = ContentAlignment.MiddleCenter;
		status.Font = new Font("Segoe UI", 12f);
		status.ForeColor = Color.FromArgb(20, 38, 65);
		status.Text = "Opening Branchline Workspace…";
		stage.Controls.Add(status);
		stage.Controls.Add(loadingScreen);
		status.Visible = false;
		loadingScreen.BringToFront();
		base.Resize += delegate
		{
			LayoutRail();
		};
		sessionWatch.Tick += async delegate
		{
			await SyncDesk();
		};
		base.Shown += async delegate
		{
			await Initialize();
		};
		base.FormClosed += delegate
		{
			sessionWatch.Dispose();
			wordmark.Dispose();
			megasaverHeaderImage.Dispose();
			brandWordartImage.Dispose();
		};
		LayoutRail();
	}

	private void LayoutRail()
	{
		bool flag = base.ClientSize.Width * 96 < 820 * base.DeviceDpi;
		if (narrowLayout != flag)
		{
			narrowLayout = flag;
			menuOpen = !flag;
		}
		menu.AccessibleDescription = menuOpen ? "Close active application workspace menu" : "Open active application workspace menu";
		menu.Selected = menuOpen;
		menu.Invalidate();
		// Application switcher always remains visible; the Branchline icon toggles
		// only the CURRENT application's menu, never the application selector.
		shell.ColumnStyles[0].Width = 0;
		rail.Visible = true;
		rail.Width = flag ? 276 : 354;
		brandWordart.Visible = base.ClientSize.Width * 96 >= 1040 * base.DeviceDpi;
		brandWordart.Width = base.ClientSize.Width * 96 >= 1320 * base.DeviceDpi ? 300 : 245;
		UpdateHeader();
		for (int i = 0; i < tabs.Length; i++)
		{
			tabs[i].Selected = selected == i || (i == 1 && selected == 2);
			tabs[i].Invalidate();
		}
		string text = ((!menuOpen) ? "closed" : (flag ? "open" : "wide"));
		if (ready && text != lastMenuState)
		{
			lastMenuState = text;
			Task task = Task.WhenAll(ApplyMenuState(sales), ApplyMenuState(ptg), ApplyMenuState(megaFrame), ApplyMenuState(megaFlyer));
		}
	}

	private void UpdateHeader()
	{
		// 1st Megasaver is the shared organizational identity for ALL four apps.
		// Transparent artwork sits directly on the opaque navy native header.
		megasaverHeader.Visible = true;
		activeTitle.Visible = false;
		activeTitle.Text = selected switch
		{
			0 => "Sales Tracker",
			3 => "MegaFrame Studio",
			4 => "MegaFlyer Studio",
			_ => "Price Tag Generator"
		};
		// Shorter window widths never squeeze app icons onto the active heading.
		megasaverHeader.Padding = new Padding(5, 9, 5, 9);
	}

	private async Task ApplyFrameTheme(CoreWebView2Frame frame)
	{
		try
		{
			await frame.ExecuteScriptAsync(themeScript.Replace("https://kzamora19.github.io", "https://" + trustedHost));
			if (lastMenuState != null)
			{
				await frame.ExecuteScriptAsync("document.documentElement.dataset.branchlineMenu = '" + lastMenuState + "';");
			}
		}
		catch (InvalidOperationException)
		{
		}
		catch (COMException)
		{
		}
	}

	private async Task ApplyMenuState(WebView2 view)
	{
		if (!ready || base.IsDisposed || view.CoreWebView2 == null || lastMenuState == null)
		{
			return;
		}
		string state = lastMenuState;
		try
		{
			await view.CoreWebView2.ExecuteScriptAsync("(() => { const value = '" + state + "'; document.documentElement.dataset.branchlineMenu = value; try { const frame = document.getElementById('branchline-native-data-desk'); if (frame?.contentDocument?.documentElement) frame.contentDocument.documentElement.dataset.branchlineMenu = value; } catch {} })()");
		}
		catch (Exception) { }
		if (studioFrames.TryGetValue(view, out var frames))
		{
			// Authorized sandboxed editors keep their own state and storage;
			// the native shell only tells their existing menu whether to show.
			foreach (CoreWebView2Frame frame in frames.ToArray())
			{
				try { await frame.ExecuteScriptAsync("document.documentElement.dataset.blNativeMenu='" + state + "';"); }
				catch (Exception) { frames.Remove(frame); }
			}
		}
	}

	private async Task Initialize()
	{
		try
		{
			string folder = (verify ? Path.Combine(Path.GetTempPath(), "BranchlineWorkspaceTest-" + Guid.NewGuid().ToString("N")) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Branchline", "WorkspaceBrowser"));
			CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, folder);
			await sales.EnsureCoreWebView2Async(environment);
			await ptg.EnsureCoreWebView2Async(environment);
			await megaFrame.EnsureCoreWebView2Async(environment);
			await megaFlyer.EnsureCoreWebView2Async(environment);
			await ConfigureStudio(megaFrame, "/megaframe-studio/studio/", "MegaFrame Studio", "MegaFlyer Studio");
			await ConfigureStudio(megaFlyer, "/flyer-studio/studio/", "MegaFlyer Studio", "MegaFrame Studio");
			Configure(sales, "/branchline/");
			Configure(ptg, "/first-megasaver-ptg/");
			await sales.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(themeScript);
			await ptg.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(themeScript);
			ptg.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
			{
				if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var result) && IsDeskRoute(result))
				{
					args.Cancel = true;
					Task task = SelectDeskWhenReady();
				}
			};
			ptg.CoreWebView2.SourceChanged += delegate
			{
				RememberPtgPage();
			};
			sales.Source = new Uri("https://kzamora19.github.io/branchline/");
			ptg.Source = new Uri("https://kzamora19.github.io/first-megasaver-ptg/dashboard/");
			ready = true;
			status.Visible = false;
			Select(0);
			sessionWatch.Start();
			if (verifyShell)
			{
				if (tabs[4].Height != tabs[3].Height || tabs[4].Height <= 0 || tabs[2].Parent != null)
				{
					throw new InvalidOperationException("The four-app header must contain equal-sized Studio buttons and no Data Desk tile.");
				}
				await VerifyStudioNavigation();
				WriteVerification("Passed: both Studio loading screens keep animating at a steady percentage and clear when the protected editor opens.", 0);
			}
			else if (verify)
			{
				await Verify();
			}
		}
		catch (Exception ex)
		{
			if (verify)
			{
				WriteVerification(ex.ToString(), 1);
				return;
			}
			status.Text = "Branchline could not open its browser component.\n" + ex.Message;
			loadingScreen.Visible = false;
			status.Visible = true;
			status.BringToFront();
		}
	}

	private bool Trusted(Uri uri, string path)
	{
		return uri != null && uri.Scheme == Uri.UriSchemeHttps && uri.Host == trustedHost && uri.IsDefaultPort && uri.AbsolutePath.StartsWith(path, StringComparison.Ordinal);
	}

	private bool IsDeskRoute(Uri uri)
	{
		return Trusted(uri, "/first-megasaver-ptg/") && (uri.AbsolutePath.TrimEnd('/') == "/first-megasaver-ptg/data-desk/".TrimEnd('/') || Array.IndexOf(uri.Query.TrimStart('?').Split('&'), "workspace=data-desk") >= 0);
	}

	private void RememberPtgPage()
	{
		Uri source = ptg.Source;
		if (!Trusted(source, "/first-megasaver-ptg/"))
		{
			return;
		}
		if (IsDeskRoute(source))
		{
			if (selected == 1)
			{
				ptg.CoreWebView2.Navigate(lastPtgPage.AbsoluteUri);
			}
			return;
		}
		string text = source.AbsolutePath.TrimEnd('/');
		if (!(text == "/first-megasaver-ptg/".TrimEnd('/') + "/login") && !(text == "/first-megasaver-ptg/".TrimEnd('/') + "/no-access"))
		{
			lastPtgPage = source;
		}
	}

	private async Task SelectDeskWhenReady()
	{
		int requested = selectionRevision;
		for (int i = 0; i < 12; i++)
		{
			if (base.IsDisposed)
			{
				break;
			}
			if (requested != selectionRevision)
			{
				break;
			}
			if (deskAllowed)
			{
				Select(2);
				break;
			}
			await SyncDesk();
			if (!deskAllowed)
			{
				await Task.Delay(160);
			}
		}
	}

	private void Configure(WebView2 view, string path)
	{
		CoreWebView2 core = view.CoreWebView2;
		core.Settings.AreHostObjectsAllowed = false;
		core.Settings.IsWebMessageEnabled = true;
		core.Settings.IsPasswordAutosaveEnabled = true;
		core.NavigationCompleted += async delegate
		{
			await ApplyMenuState(view);
		};
		core.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs args)
		{
			HandleWebMessage(view, args);
		};
		core.FrameCreated += delegate(object sender, CoreWebView2FrameCreatedEventArgs args)
		{
			CoreWebView2Frame frame = args.Frame;
			frame.WebMessageReceived += delegate(object frameSender, CoreWebView2WebMessageReceivedEventArgs message)
			{
				HandleWebMessage(view, message);
			};
			frame.DOMContentLoaded += async delegate
			{
				await ApplyFrameTheme(frame);
			};
		};
		view.KeyDown += delegate(object sender, KeyEventArgs args)
		{
			if (TryRefreshShortcut(args.KeyData))
			{
				args.SuppressKeyPress = true;
			}
		};
		core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
		{
			if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var result) || !Trusted(result, path))
			{
				args.Cancel = true;
				if (args.IsUserInitiated)
				{
					OpenExternal(args.Uri);
				}
			}
		};
		core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
		{
			args.Handled = true;
			if (view == ptg && selected == 2 && deskAllowed && args.IsUserInitiated && Uri.TryCreate(args.Uri, UriKind.Absolute, out var result) && Trusted(result, "/branchline/") && result.AbsolutePath == "/branchline/")
			{
				string[] array = new string[4] { "inventory", "sales-history", "daily-history", "unified" };
				foreach (string text in array)
				{
					if (!(result.Query != "?workspace-import=" + text))
					{
						Task task = OpenSalesImport(text);
						return;
					}
				}
			}
			if (Uri.TryCreate(args.Uri, UriKind.Absolute, out result) && Trusted(result, path))
			{
				core.Navigate(args.Uri);
			}
			else if (args.IsUserInitiated)
			{
				OpenExternal(args.Uri);
			}
		};
	}

	private bool IsStudioNavigation(string address, string studioPath)
	{
		Uri result;
		return Uri.TryCreate(address, UriKind.Absolute, out result) && (Trusted(result, "/first-megasaver-ptg/") || (Trusted(result, studioPath) && result.AbsolutePath == studioPath));
	}

	private async Task ConfigureStudio(WebView2 view, string studioPath, string studioName, string otherStudioName)
	{
		CoreWebView2 core = view.CoreWebView2;
		core.Settings.AreHostObjectsAllowed = false;
		core.Settings.IsWebMessageEnabled = false;
		core.Settings.IsPasswordAutosaveEnabled = true;
		await core.AddScriptToExecuteOnDocumentCreatedAsync(themeScript);
		await core.AddScriptToExecuteOnDocumentCreatedAsync(studioMenuScript);
		studioFrames[view] = new List<CoreWebView2Frame>();
		core.FrameCreated += delegate(object sender, CoreWebView2FrameCreatedEventArgs args)
		{
			CoreWebView2Frame frame = args.Frame;
			studioFrames[view].Add(frame);
			frame.DOMContentLoaded += async delegate
			{
				try
				{
					await frame.ExecuteScriptAsync(studioMenuScript);
					await frame.ExecuteScriptAsync("document.documentElement.dataset.blNativeMenu='" + (menuOpen ? "open" : "closed") + "';");
				}
				catch (Exception) { /* frame can be destroyed during secure reauthorization */ }
			};
		};
		string launchUrl = StudioPortal(view);
		core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
		{
			args.Cancel = !IsStudioNavigation(args.Uri, studioPath);
			if (!string.Equals(args.Uri, launchUrl, StringComparison.Ordinal))
			{
				requestedStudioLaunches.Remove(view);
			}
		};
		core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
		{
			args.Handled = true;
			if (args.IsUserInitiated && IsStudioNavigation(args.Uri, studioPath))
			{
				core.Navigate(args.Uri);
			}
		};
		if (verifyShell)
		{
			core.AddWebResourceRequestedFilter("https://kzamora19.github.io/first-megasaver-ptg/studios/*", CoreWebView2WebResourceContext.Document);
			core.AddWebResourceRequestedFilter("https://kzamora19.github.io" + studioPath, CoreWebView2WebResourceContext.Document);
			core.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs args)
			{
				string s = ((args.Request.Uri == launchUrl) ? "<main><section class='install-panel'><div><div><h2>MegaFrame Studio</h2><button type='button' disabled onclick=\"location.href='/megaframe-studio/studio/'\">Open MegaFrame Studio</button></div><div><h2>MegaFlyer Studio</h2><button type='button' disabled onclick=\"location.href='/flyer-studio/studio/'\">Open MegaFlyer Studio</button></div></div></section></main><script>setTimeout(() => document.querySelectorAll('button').forEach(button => button.disabled = false), 2800)</script>" : "<nav class='bl-protected-app-rail'>Duplicate app rail</nav><main><iframe id='studio-editor-frame' srcdoc='Protected editor fixture'></iframe></main>");
				args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(s)), 200, "OK", "Content-Type: text/html");
			};
		}
		JavaScriptSerializer json = new JavaScriptSerializer();
		core.DOMContentLoaded += async delegate
		{
			if (!requestedStudioLaunches.Remove(view) || core.Source != launchUrl)
			{
				return;
			}
			try
			{
				await core.ExecuteScriptAsync("(function (url, name) {\n                        if (location.href !== url) return;\n                        const observer = new MutationObserver(launch);\n                        const timeout = setTimeout(() => observer.disconnect(), 30000);\n                        function launch() {\n                            const buttons = document.querySelectorAll('main > section.install-panel button[type=button]');\n                            const button = Array.from(buttons).find(item =>\n                                item.textContent.trim() === 'Open ' + name && !item.disabled);\n                            if (!button) return;\n                            observer.disconnect();\n                            clearTimeout(timeout);\n                            button.click();\n                        }\n                        observer.observe(document, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled']});\n                        launch();\n                    })(" + json.Serialize(launchUrl) + "," + json.Serialize(studioName) + ");");
			}
			catch (InvalidOperationException)
			{
			}
			catch (COMException)
			{
			}
		};
		await core.AddScriptToExecuteOnDocumentCreatedAsync("(function (origin, path, studio, otherStudio) {\n                if (window.top !== window || location.origin !== origin ||\n                    location.pathname !== path) return;\n\n                function updatePortal() {\n                    const panel = document.querySelector('main > section.install-panel');\n                    if (!panel) return;\n                    const headings = Array.from(panel.querySelectorAll('h2'));\n                    const selected = headings.find(heading => heading.textContent.trim() === studio);\n                    const other = headings.find(heading => heading.textContent.trim() === otherStudio);\n                    if (selected && other && selected.parentElement.parentElement === other.parentElement.parentElement)\n                        other.parentElement.style.setProperty('display', 'none', 'important');\n\n                }\n\n                new MutationObserver(updatePortal).observe(document, {\n                    childList: true, subtree: true, characterData: true\n                });\n                updatePortal();\n            })(" + json.Serialize("https://kzamora19.github.io") + "," + json.Serialize("/first-megasaver-ptg/studios/") + "," + json.Serialize(studioName) + "," + json.Serialize(otherStudioName) + ");");
	}

	private string StudioPortal(WebView2 view)
	{
		return "https://kzamora19.github.io/first-megasaver-ptg/studios/" + ((view == megaFrame) ? "?studio=megaframe" : "?studio=flyer");
	}

	private void ShowActiveView()
	{
		WebView2 webView = ViewFor(selected);
		webView.BringToFront();
		loadingScreen.Visible = loadingStudios.Contains(webView);
		if (loadingScreen.Visible)
		{
			loadingScreen.ShowStudio((webView == megaFrame) ? "MegaFrame Studio" : "MegaFlyer Studio", authorizingEditors.Contains(webView));
			loadingScreen.BringToFront();
		}
	}

	private async Task WaitForStudio(WebView2 view)
	{
		try
		{
			for (int i = 0; i < 150; i++)
			{
				if (base.IsDisposed)
				{
					break;
				}
				Uri page = view.Source;
				if (Trusted(page, "/first-megasaver-ptg/") && page.AbsolutePath == "/first-megasaver-ptg/studios/")
				{
					if (await view.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('main > section.install-panel [role=alert]'))") == "true")
					{
						break;
					}
				}
				else if (Trusted(page, (view == megaFrame) ? "/megaframe-studio/studio/" : "/flyer-studio/studio/"))
				{
					if (authorizingEditors.Add(view) && ViewFor(selected) == view)
					{
						ShowActiveView();
					}
					if (await view.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('#studio-editor-frame, #status a'))") == "true")
					{
						break;
					}
				}
				else if (Trusted(page, "/first-megasaver-ptg/"))
				{
					break;
				}
				await Task.Delay(200);
			}
		}
		catch (InvalidOperationException)
		{
		}
		catch (COMException)
		{
		}
		finally
		{
			loadingStudios.Remove(view);
			authorizingEditors.Remove(view);
			requestedStudioLaunches.Remove(view);
			if (!base.IsDisposed && ViewFor(selected) == view)
			{
				ShowActiveView();
			}
		}
	}

	private WebView2 ViewFor(int app)
	{
		return app switch
		{
			0 => sales, 
			3 => megaFrame, 
			4 => megaFlyer, 
			_ => ptg, 
		};
	}

	private void HandleWebMessage(WebView2 view, CoreWebView2WebMessageReceivedEventArgs args)
	{
		if (selected == 0 == (view == sales) && Uri.TryCreate(args.Source, UriKind.Absolute, out var result) && (Trusted(result, "/branchline/") || Trusted(result, "/first-megasaver-ptg/")))
		{
			string text;
			try
			{
				text = args.TryGetWebMessageAsString();
			}
			catch (ArgumentException)
			{
				return;
			}
			if (text == "branchline:refresh" || text == "branchline:hard-refresh")
			{
				QueueRefresh(text == "branchline:hard-refresh");
			}
			else if (text == "branchline:close-menu" && lastMenuState == "open")
			{
				menuOpen = false;
				LayoutRail();
			}
		}
	}

	protected override bool ProcessCmdKey(ref Message message, Keys keyData)
	{
		if (keyData == Keys.Escape && menuOpen)
		{
			menuOpen = false;
			LayoutRail();
			return true;
		}
		return TryRefreshShortcut(keyData) || base.ProcessCmdKey(ref message, keyData);
	}

	private bool TryRefreshShortcut(Keys keys)
	{
		Keys keys2 = keys & Keys.KeyCode;
		bool flag = (keys & Keys.Control) != 0;
		if (!ready || (keys & Keys.Alt) != Keys.None || (keys2 != Keys.F5 && (!flag || keys2 != Keys.R)))
		{
			return false;
		}
		QueueRefresh((keys & Keys.Shift) != Keys.None || (flag && keys2 == Keys.F5));
		return true;
	}

	private void QueueRefresh(bool hard)
	{
		if (ready && !refreshing && !base.IsDisposed)
		{
			refreshing = true;
			BeginInvoke((Action)async delegate
			{
				await RefreshActivePage(hard);
			});
		}
	}

	private async Task RefreshActivePage(bool hard)
	{
		WebView2 view = ViewFor(selected);
		CoreWebView2 core = view.CoreWebView2;
		bool desk = selected == 2;
		TaskCompletionSource<bool> completed = new TaskCompletionSource<bool>();
		EventHandler<CoreWebView2NavigationCompletedEventArgs> loaded = delegate(object sender, CoreWebView2NavigationCompletedEventArgs args)
		{
			completed.TrySetResult(args.IsSuccess);
		};
		try
		{
			if (desk)
			{
				core.FrameNavigationCompleted += loaded;
			}
			else
			{
				core.NavigationCompleted += loaded;
			}
			if (hard)
			{
				await core.CallDevToolsProtocolMethodAsync("Network.setBypassServiceWorker", "{\"bypass\":true}");
				await core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":true}");
			}
			if (desk)
			{
				await core.ExecuteScriptAsync("document.getElementById('branchline-native-data-desk')?.contentWindow?.location.reload()");
			}
			else if (hard)
			{
				await core.CallDevToolsProtocolMethodAsync("Page.reload", "{\"ignoreCache\":true}");
			}
			else
			{
				core.Reload();
			}
			await Task.WhenAny(completed.Task, Task.Delay(12000));
		}
		catch (Exception)
		{
		}
		try
		{
			if (desk)
			{
				core.FrameNavigationCompleted -= loaded;
			}
			else
			{
				core.NavigationCompleted -= loaded;
			}
			if (hard && !base.IsDisposed)
			{
				await core.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":false}");
				await core.CallDevToolsProtocolMethodAsync("Network.setBypassServiceWorker", "{\"bypass\":false}");
			}
		}
		catch (Exception)
		{
		}
		finally
		{
			refreshing = false;
		}
	}

	private async Task OpenSalesImport(string tool)
	{
		Select(0);
		try
		{
			if (!Trusted(sales.Source, "/branchline/"))
			{
				throw new InvalidOperationException("Open Sales Tracker and sign in first.");
			}
			JavaScriptSerializer json = new JavaScriptSerializer();
			object result;
			object outcome;
			switch ((json.DeserializeObject(await sales.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", json.Serialize(new
			{
				expression = salesImportScript.Replace("IMPORT_TOOL", tool),
				awaitPromise = true,
				returnByValue = true
			}))) is Dictionary<string, object> data && data.TryGetValue("result", out result) && result is Dictionary<string, object> && ((Dictionary<string, object>)result).TryGetValue("value", out outcome)) ? (outcome as string) : null)
			{
			case "signin":
				throw new InvalidOperationException("Sign in to Sales Tracker, then choose the importer in Data Desk again.");
			case "busy":
				throw new InvalidOperationException("Close the current Sales Tracker dialog before opening another importer.");
			case "denied":
				throw new InvalidOperationException("This Sales Tracker account does not have access to the selected importer.");
			default:
				throw new InvalidOperationException("Open the importer from Sales Tracker → Settings → Import Center.");
			}
		}
		catch (Exception ex)
		{
			if (!base.IsDisposed)
			{
				MessageBox.Show(this, ex.Message, "Sales Tracker import");
			}
		}
	}

	private static void OpenExternal(string address)
	{
		if (!Uri.TryCreate(address, UriKind.Absolute, out var result) || result.Scheme != Uri.UriSchemeHttps)
		{
			return;
		}
		try
		{
			ProcessStartInfo processStartInfo = new ProcessStartInfo(result.AbsoluteUri);
			processStartInfo.UseShellExecute = true;
			Process.Start(processStartInfo);
		}
		catch (Exception ex)
		{
			MessageBox.Show(ex.Message, "Could not open link");
		}
	}

	private void Select(int app)
	{
		if (ready && (app != 2 || deskAllowed))
		{
			selected = app;
			selectionRevision++;
			if (narrowLayout == true)
			{
				menuOpen = false;
			}
			if (app == 1 && IsDeskRoute(ptg.Source))
			{
				ptg.CoreWebView2.Navigate(lastPtgPage.AbsoluteUri);
			}
			WebView2 webView = ViewFor(app);
			if (app >= 3 && !loadingStudios.Contains(webView) && (webView.Source == null || webView.Source.Scheme == "about" || Trusted(webView.Source, "/first-megasaver-ptg/")))
			{
				loadingStudios.Add(webView);
				requestedStudioLaunches.Add(webView);
				webView.CoreWebView2.Navigate(StudioPortal(webView));
				Task task = WaitForStudio(webView);
			}
			ShowActiveView();
			LayoutRail();
			Task task2 = ApplyDeskVisibility();
			Task task3 = SyncDesk();
		}
	}

	private async Task ApplyDeskVisibility()
	{
		if (!ready || base.IsDisposed || !Trusted(ptg.Source, "/first-megasaver-ptg/"))
		{
			return;
		}
		try
		{
			await ptg.CoreWebView2.ExecuteScriptAsync("document.documentElement.toggleAttribute('data-branchline-show-desk'," + ((selected == 2 && deskAllowed) ? "true" : "false") + ");");
		}
		catch (InvalidOperationException)
		{
		}
		catch (COMException)
		{
		}
	}

	private async Task SyncDesk()
	{
		if (!ready || checking || base.IsDisposed)
		{
			return;
		}
		checking = true;
		int before = selected;
		try
		{
			Uri page = ptg.Source;
			if (!Trusted(page, "/first-megasaver-ptg/"))
			{
				return;
			}
			string state = await ptg.CoreWebView2.ExecuteScriptAsync(frameScript);
			if (base.IsDisposed || ptg.Source != page || state == "\"checking\"")
			{
				return;
			}
			bool allowed = state == "\"allowed\"";
			string authPage = state switch
			{
				"\"change-password\"" => "change-password", 
				"\"no-access\"" => "no-access", 
				"\"login\"" => "login", 
				_ => null, 
			};
			if (!allowed && state != "\"denied\"" && authPage == null)
			{
				return;
			}
			if (deskAllowed != allowed)
			{
				deskAllowed = allowed;
				if (!allowed && selected == 2)
				{
					Select(1);
				}
				LayoutRail();
				await ApplyDeskVisibility();
			}
			if (authPage != null && !base.IsDisposed && ptg.Source == page)
			{
				ptg.CoreWebView2.Navigate("https://kzamora19.github.io".Replace("kzamora19.github.io", trustedHost) + "/first-megasaver-ptg/" + authPage + "/");
			}
		}
		catch (InvalidOperationException)
		{
		}
		catch (COMException)
		{
		}
		finally
		{
			checking = false;
		}
		if (!base.IsDisposed && before != selected)
		{
			await SyncDesk();
		}
	}

	private async Task VerifyStudioNavigation()
	{
		for (int app = 3; app <= 4; app++)
		{
			WebView2 view = ViewFor(app);
			string studioPath = ((app == 3) ? "/megaframe-studio/studio/" : "/flyer-studio/studio/");
			string otherPath = ((app == 3) ? "/flyer-studio/studio/" : "/megaframe-studio/studio/");
			if (!IsStudioNavigation("https://kzamora19.github.io" + studioPath, studioPath) || IsStudioNavigation("https://kzamora19.github.io" + otherPath, studioPath) || IsStudioNavigation("https://kzamora19.github.io" + studioPath.Replace("/studio/", "/"), studioPath))
			{
				throw new InvalidOperationException("Studio navigation isolation failed for " + studioPath);
			}
			Select(app);
			if (!loadingScreen.Visible || stage.Controls.GetChildIndex(loadingScreen) != 0)
			{
				throw new InvalidOperationException("The workspace loader did not cover the Studio portal.");
			}
			if (verifyShell)
			{
				int before = loadingScreen.Progress;
				await Task.Delay(220);
				if (!loadingScreen.Visible || loadingScreen.Progress <= before)
				{
					throw new InvalidOperationException("The Studio loading animation did not advance.");
				}
				await Task.Delay(1550);
				int settled = loadingScreen.Progress;
				using Bitmap first = new Bitmap(loadingScreen.Width, loadingScreen.Height);
				using Bitmap second = new Bitmap(first.Width, first.Height);
				Rectangle bounds = new Rectangle(Point.Empty, first.Size);
				loadingScreen.DrawToBitmap(first, bounds);
				await Task.Delay(180);
				loadingScreen.DrawToBitmap(second, bounds);
				int row = first.Height / 2 - (int)((float)(31 * loadingScreen.DeviceDpi) / 96f);
				bool moved = false;
				for (int i = first.Width / 4; i < first.Width * 3 / 4; i += 4)
				{
					moved |= first.GetPixel(i, row) != second.GetPixel(i, row);
				}
				if (!loadingScreen.Visible || settled != loadingScreen.Progress || !moved)
				{
					throw new InvalidOperationException("The Studio loading animation stopped moving while waiting.");
				}
			}
			string expected = (verifyShell ? ("https://kzamora19.github.io" + studioPath) : StudioPortal(view));
			for (int j = 0; j < 80; j++)
			{
				if (view.Source != null && view.Source.AbsoluteUri == expected && (!verifyShell || !loadingStudios.Contains(view)))
				{
					break;
				}
				await Task.Delay(50);
			}
			if ((verifyShell && (loadingScreen.Visible || stage.Controls.GetChildIndex(view) != 0)) || view.Source == null || view.Source.AbsoluteUri != expected)
			{
				throw new InvalidOperationException("Studio did not open after one selection: " + view.Source);
			}
			if (verifyShell && await view.CoreWebView2.ExecuteScriptAsync("getComputedStyle(document.querySelector('.bl-protected-app-rail')).display") != "\"none\"")
			{
				throw new InvalidOperationException("The Studio web app rail is still visible.");
			}
		}
		Select(0);
	}

	private async Task Verify()
	{
		if (!sales.CoreWebView2.Settings.IsPasswordAutosaveEnabled || !ptg.CoreWebView2.Settings.IsPasswordAutosaveEnabled)
		{
			throw new InvalidOperationException("Password autofill is disabled in a workspace tab.");
		}
		for (int i = 0; i < 90; i++)
		{
			string a = await sales.CoreWebView2.ExecuteScriptAsync("document.body?.innerText.includes('SIGN IN') || document.body?.innerText.includes('Sign in')");
			string b = await ptg.CoreWebView2.ExecuteScriptAsync("!!document.querySelector('#username')");
			if (a == "true" && b == "true")
			{
				Select(1);
				if (stage.Controls.GetChildIndex(ptg) != 0 || deskAllowed)
				{
					throw new InvalidOperationException("PTG selection or signed-out Data Desk visibility failed.");
				}
				Select(0);
				if (stage.Controls.GetChildIndex(sales) != 0)
				{
					throw new InvalidOperationException("Sales Tracker selection failed.");
				}
				if (tabs[4].Height != tabs[3].Height || tabs[4].Height <= 0 || tabs[2].Parent != null)
				{
					throw new InvalidOperationException("The four-app header must contain equal-sized Studio buttons and no Data Desk tile.");
				}
				await VerifyStudioNavigation();
				if (!menu.Visible || !rail.Visible)
				{
					throw new InvalidOperationException("The wide menu was missing.");
				}
				menu.PerformClick();
				if (!menu.Visible || rail.Visible)
				{
					throw new InvalidOperationException("The wide menu did not collapse.");
				}
				menu.PerformClick();
				if (!rail.Visible)
				{
					throw new InvalidOperationException("The wide menu did not reopen.");
				}
				await sales.CoreWebView2.ExecuteScriptAsync("document.documentElement.dataset.refreshProbe = 'before'");
				if (!TryRefreshShortcut(Keys.R | Keys.Shift | Keys.Control))
				{
					throw new InvalidOperationException("The hard refresh shortcut was not handled.");
				}
				for (int attempt = 0; attempt < 30; attempt++)
				{
					if (!refreshing)
					{
						break;
					}
					await Task.Delay(200);
				}
				if (refreshing || selected != 0 || await sales.CoreWebView2.ExecuteScriptAsync("document.documentElement.hasAttribute('data-refresh-probe')") != "false")
				{
					throw new InvalidOperationException("The hard refresh did not reload Sales Tracker.");
				}
				base.ClientSize = new Size(580, 590);
				if (!menu.Visible || rail.Visible)
				{
					throw new InvalidOperationException("Narrow menu did not collapse.");
				}
				menu.PerformClick();
				if (!rail.Visible)
				{
					throw new InvalidOperationException("Narrow menu did not expand.");
				}
				tabs[1].PerformClick();
				if (rail.Visible || selected != 1)
				{
					throw new InvalidOperationException("App selection did not collapse the menu.");
				}
				await VerifyDeskFrame();
				WriteVerification("Passed: live sign-in pages, Studio tabs and protected routes, standalone editor blocking, tab switching, menu, Data Desk, refresh, and access recovery.", 0);
				return;
			}
			await Task.Delay(350);
		}
		throw new InvalidOperationException("The two live sign-in pages did not finish loading.");
	}

	private async Task VerifyDeskFrame()
	{
		CoreWebView2 core = ptg.CoreWebView2;
		string fixturePath = Path.Combine(Path.GetTempPath(), "BranchlineFrameTest-" + Guid.NewGuid().ToString("N"));
		string appFolder = Path.Combine(fixturePath, "/first-megasaver-ptg/".Trim('/'));
		Directory.CreateDirectory(appFolder);
		string deskFixture = "/first-megasaver-ptg/workspace-test-desk.html";
		File.WriteAllText(Path.Combine(appFolder, "workspace-test.html"), "<!doctype html><div class='ptg-app'><aside class='ptg-sidebar'><button class='ptg-menu-toggle'>Web menu</button><nav aria-label='Workspace'><a id='admin-marker' href='" + deskFixture + "'>Data Desk Pilot</a><a id='open-desk' href='/first-megasaver-ptg/data-desk/'>Data Desk</a></nav></aside><main>PTG content</main></div>");
		File.WriteAllText(Path.Combine(appFolder, "workspace-test-desk.html"), "<!doctype html><div class='ptg-app'><aside class='ptg-sidebar'><button class='ptg-menu-toggle'>Web menu</button></aside><main><h1>Data Desk catalog pilot</h1></main></div>");
		frameScript = frameScript.Replace("/first-megasaver-ptg/data-desk/", deskFixture);
		trustedHost = "branchline-workspace.test";
		await core.AddScriptToExecuteOnDocumentCreatedAsync(themeScript.Replace("https://kzamora19.github.io", "https://" + trustedHost));
		core.SetVirtualHostNameToFolderMapping(trustedHost, fixturePath, CoreWebView2HostResourceAccessKind.DenyCors);
		core.Navigate("https://" + trustedHost + "/first-megasaver-ptg/workspace-test.html");
		for (int i = 0; i < 30; i++)
		{
			if (deskAllowed)
			{
				break;
			}
			await Task.Delay(250);
			await SyncDesk();
		}
		if (!deskAllowed)
		{
			throw new InvalidOperationException("Admin Data Desk did not become available. " + await core.ExecuteScriptAsync("({url:location.pathname+location.search,body:document.body?.innerText.slice(0,140),link:document.querySelector('a')?.getAttribute('href'),frame:document.querySelector('iframe')?.contentDocument?.body?.textContent})"));
		}
		menu.PerformClick();
		await Task.Delay(300);
		if (await core.ExecuteScriptAsync("(() => { const bar=document.querySelector('.ptg-sidebar'); return document.documentElement.dataset.branchlineMenu==='open' && getComputedStyle(bar).position==='fixed' && bar.getBoundingClientRect().left===0 && getComputedStyle(document.querySelector('.ptg-menu-toggle')).display==='none'; })()") != "true" || menu.Left > menu.Parent.Width / 2)
		{
			throw new InvalidOperationException("The single upper-left menu did not open the left drawer.");
		}
		await core.ExecuteScriptAsync("document.getElementById('branchline-native-menu-backdrop').click()");
		for (int attempt = 0; attempt < 12; attempt++)
		{
			if (!menuOpen)
			{
				break;
			}
			await Task.Delay(70);
		}
		if (menuOpen)
		{
			throw new InvalidOperationException("Clicking outside the drawer did not close the menu.");
		}
		await core.ExecuteScriptAsync("document.querySelector('iframe').contentDocument.querySelector('main').innerHTML = '<h1>PTG is unavailable</h1>'");
		await SyncDesk();
		if (!deskAllowed)
		{
			throw new InvalidOperationException("A temporary Data Desk error hid the admin tab.");
		}
		await core.ExecuteScriptAsync("document.getElementById('open-desk').click()");
		for (int j = 0; j < 20; j++)
		{
			await Task.Delay(150);
			if (selected != 2 || !(await core.ExecuteScriptAsync("document.getElementById('branchline-native-data-desk')?.style.opacity") == "\"1\""))
			{
				continue;
			}
			if (ptg.Source.AbsolutePath != "/first-megasaver-ptg/workspace-test.html")
			{
				throw new InvalidOperationException("The PTG sidebar link replaced the current PTG page.");
			}
			menu.PerformClick();
			await Task.Delay(300);
			if (await core.ExecuteScriptAsync("(() => { const frame = document.getElementById('branchline-native-data-desk'); const doc = frame.contentDocument; const bar = doc.querySelector('.ptg-sidebar'); const win = frame.contentWindow; return doc.documentElement.dataset.branchlineMenu==='open' && getComputedStyle(document.body).overflow==='hidden' && win.getComputedStyle(bar).position==='fixed' && bar.getBoundingClientRect().left===0 && win.getComputedStyle(doc.querySelector('.ptg-menu-toggle')).display==='none'; })()") != "true")
			{
				throw new InvalidOperationException("The embedded Data Desk showed a second menu or a top menu.");
			}
			await core.ExecuteScriptAsync("document.querySelector('iframe').contentDocument.getElementById('branchline-native-menu-backdrop').click()");
			for (int k = 0; k < 12; k++)
			{
				if (!menuOpen)
				{
					break;
				}
				await Task.Delay(70);
			}
			if (menuOpen)
			{
				throw new InvalidOperationException("The Data Desk backdrop did not close the single menu.");
			}
			await core.ExecuteScriptAsync("(() => { const win = document.querySelector('iframe').contentWindow; win.document.documentElement.dataset.refreshProbe='before'; win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key:'R', ctrlKey:true, shiftKey:true, bubbles:true })); })()");
			for (int l = 0; l < 40; l++)
			{
				await Task.Delay(150);
				if (!refreshing && await core.ExecuteScriptAsync("(() => { const doc = document.querySelector('iframe')?.contentDocument; return !!doc?.querySelector('h1') && !doc.documentElement.hasAttribute('data-refresh-probe'); })()") == "true")
				{
					break;
				}
			}
			if (refreshing || selected != 2 || await core.ExecuteScriptAsync("document.querySelector('iframe')?.contentDocument?.documentElement.hasAttribute('data-refresh-probe')") != "false")
			{
				throw new InvalidOperationException("Refreshing Data Desk did not reload its own page.");
			}
			await core.ExecuteScriptAsync("window.deskMarker=document.querySelector('#admin-marker'); document.querySelector('nav').remove()");
			await SyncDesk();
			if (!deskAllowed || selected != 2)
			{
				throw new InvalidOperationException("A temporarily missing sidebar reset the Data Desk selection.");
			}
			await core.ExecuteScriptAsync("const nav=document.createElement('nav'); nav.setAttribute('aria-label','Workspace'); document.querySelector('aside').append(nav); nav.append(window.deskMarker)");
			Select(1);
			await ApplyDeskVisibility();
			if (await core.ExecuteScriptAsync("getComputedStyle(document.getElementById('branchline-native-data-desk')).opacity") != "\"0\"")
			{
				throw new InvalidOperationException("The Data Desk overlay remained visible after selecting PTG.");
			}
			await core.ExecuteScriptAsync("document.documentElement.dataset.refreshProbe = 'before'");
			if (!TryRefreshShortcut(Keys.R | Keys.Shift | Keys.Control))
			{
				throw new InvalidOperationException("The PTG hard refresh shortcut was not handled.");
			}
			for (int m = 0; m < 30; m++)
			{
				if (!refreshing)
				{
					break;
				}
				await Task.Delay(150);
			}
			if (refreshing || selected != 1 || await core.ExecuteScriptAsync("document.documentElement.hasAttribute('data-refresh-probe')") != "false")
			{
				throw new InvalidOperationException("The PTG hard refresh did not reload PTG.");
			}
			await core.ExecuteScriptAsync("window.deskMarker=document.querySelector('#admin-marker')");
			await SyncDesk();
			Uri outerPage = ptg.Source;
			core.Navigate("https://" + trustedHost + "/first-megasaver-ptg/data-desk/");
			for (int n = 0; n < 10; n++)
			{
				if (selected == 2)
				{
					break;
				}
				await Task.Delay(100);
			}
			if (selected != 2 || ptg.Source != outerPage)
			{
				throw new InvalidOperationException("Cross-App Catalog navigation replaced the PTG page.");
			}
			await core.ExecuteScriptAsync("document.querySelector('a').remove()");
			for (int num = 0; num < 10; num++)
			{
				if (!deskAllowed)
				{
					break;
				}
				await SyncDesk();
				await Task.Delay(100);
			}
			if (deskAllowed || selected != 1)
			{
				throw new InvalidOperationException("Data Desk remained available after access changed.");
			}
			await core.ExecuteScriptAsync("document.querySelector('nav').append(window.deskMarker)");
			for (int num2 = 0; num2 < 15; num2++)
			{
				if (deskAllowed)
				{
					break;
				}
				await SyncDesk();
				await Task.Delay(100);
			}
			Select(2);
			if (selected != 2)
			{
				throw new InvalidOperationException("Data Desk did not return for the restored admin.");
			}
			await core.ExecuteScriptAsync("document.querySelector('iframe').contentWindow.history.replaceState(null,'','/first-megasaver-ptg/login/')");
			for (int num3 = 0; num3 < 15; num3++)
			{
				if (!(ptg.Source.AbsolutePath != "/first-megasaver-ptg/login/"))
				{
					break;
				}
				await SyncDesk();
				await Task.Delay(100);
			}
			if (deskAllowed || selected != 1 || ptg.Source.AbsolutePath != "/first-megasaver-ptg/login/")
			{
				throw new InvalidOperationException("Data Desk session expiry did not show PTG sign-in.");
			}
			return;
		}
		throw new InvalidOperationException("Data Desk did not display in the existing PTG surface.");
	}

	private void WriteVerification(string text, int code)
	{
		File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "workspace-verification.log"), text);
		exitCode = code;
		Close();
	}
}
