using Branchline.Workspace;

string[] expectedInShell =
{
    "https://branchline-staging.github.io/",
    "https://branchline-staging.github.io/sales-tracker/",
    "https://branchline-staging.github.io/sales-tracker/apps/",
    "https://branchline-staging.github.io/first-megasaver-ptg/login/",
    "https://branchline-staging.github.io/first-megasaver-ptg/products/",
    "https://branchline-staging.github.io/first-megasaver-ptg/data-desk/",
    "https://branchline-staging.github.io/first-megasaver-ptg/studios/?studio=megaframe",
    "https://branchline-staging.github.io/first-megasaver-ptg/studios/?studio=flyer",
    "https://branchline-staging.github.io/megaframe-studio/studio/",
    "https://branchline-staging.github.io/flyer-studio/studio/"
};
string[] expectedOutside =
{
    "https://kzamora19.github.io/branchline/apps/",
    "https://kzamora19.github.io/first-megasaver-ptg/login/",
    "https://kzamora19.github.io/megaframe-studio/studio/",
    "https://branchline-staging.github.io/other-repo/",
    "https://branchline-staging.github.io/flyer-studio/",
    "https://branchline-staging.github.io/megaframe-studio/",
    "https://branchline-staging.github.io.evil.example/",
    "https://wrong.github.io/",
    "http://branchline-staging.github.io/",
    "https://user@branchline-staging.github.io/",
    "https://branchline-staging.github.io:444/sales-tracker/",
    "https://branchline-staging.github.io/sales-tracker-fake/",
    "https://branchline-staging.github.io/first-megasaver-ptg-fake/",
    "javascript:alert(1)",
    ""
};
foreach (var url in expectedInShell)
    if (!WorkspaceNavigationPolicy.IsInternalAppUrl(url))
        throw new Exception("Expected STAGING workspace route: " + url);
foreach (var url in expectedOutside)
    if (WorkspaceNavigationPolicy.IsInternalAppUrl(url))
        throw new Exception("Unexpectedly trusted external or production route: " + url);

Console.WriteLine("PASS: " + expectedInShell.Length +
    " staging routes and " + expectedOutside.Length + " production/untrusted routes rejected.");
