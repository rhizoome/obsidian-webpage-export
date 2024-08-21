import { AliasesOptions } from "./features/aliases";
import { BacklinksOptions } from "./features/backlinks";
import { CustomHeadOptions } from "./features/custom-head";
import { DocumentOptions } from "./features/document";
import { FileNavigationOptions } from "./features/file-navigation";
import { GraphViewOptions } from "./features/graph-view";
import { OutlineOptions } from "./features/outline";
import { PropertiesOptions } from "./features/properties";
import { SearchOptions } from "./features/search";
import { SidebarOptions } from "./features/sidebar";
import { TagsOptions } from "./features/tags";
import { ThemeToggleOptions } from "./features/theme-toggle";

export enum EmojiStyle
{
	Native = "Native",
	Twemoji = "Twemoji",
	OpenMoji = "OpenMoji",
	OpenMojiOutline = "OpenMojiOutline",
	FluentUI = "FluentUI",
}

export enum ObsidianFileType
{
	Markdown = "markdown",
	Canvas = "canvas",
	Excalidraw = "excalidraw",
	Kanban = "kanban",
	Attachment = "attachment",
	Other = "other"
}

export class Stat
{
	createdTime: number = 0;
	modifiedTime: number = 0;
	sourceSize: number = 0;
}

export class FileData
{
	stat: Stat = new Stat();
	path: string = "";
	sourcePath: string = "";
	showInTree: boolean = false;
	treeOrder: number = 0;
	backlinks: string[] = [];
	type: ObsidianFileType = ObsidianFileType.Other;
	data: string | null = null;
}

export interface HeadingData
{
	heading: string;
	level: number;
	id: string;
}

export class WebpageData extends FileData
{
	headers: HeadingData[] = [];
	aliases: string[] = [];
	inlineTags: string[] = [];
	frontmatterTags: string[] = [];
	links: string[] = [];
	attachments: string[] = [];

	contentPath: string = "";
	title: string = "";
	pathToRoot: string = "";
	icon: string = "";
	description: string = "";
	author: string = "";
	coverImageURL: string = "";
	url: string = "";

	outlineHTML: string = "";
}

export class WebsiteFeatureOptions
{
	/**
	 * The options for the backlinks feature.
	 */
	backlinks: BacklinksOptions;

	/**
	 * The options for the tags feature.
	 */
	tags: TagsOptions;

	/**
	 * The options for the aliases feature.
	 */
	alias: AliasesOptions;

	/**
	 * The options for the properties feature.
	 */
	properties: PropertiesOptions;

	/**
	 * The options for the file navigation feature.
	 */
	fileNavigation: FileNavigationOptions;

	/**
	 * The options for the search feature.
	 */
	search: SearchOptions;

	/**
	 * The options for the outline feature.
	 */
	outline: OutlineOptions;

	/**
	 * The options for the theme toggle feature.
	 */
	themeToggle: ThemeToggleOptions;

	/**
	 * The options for the graph view feature.
	 */
	graphView: GraphViewOptions;

	/**
	 * The options for the sidebar feature.
	 */
	sidebar: SidebarOptions;

	/**
	 * Custom head content options
	 */
	customHead: CustomHeadOptions;

	/**
	 * Document section options
	 */
	document: DocumentOptions;
}

export class WebsiteData
{
	allFiles: string[] = [];
	sourceToTarget: {[sourcePath: string]: string} = {};
	targetToSource: {[targetPath: string]: string} = {};
	allBacklinks: {[targetPath: string]: string[]} = {};
	allLinks: {[targetPath: string]: string[]} = {};

	siteName: string = "";
	vaultName: string = "";
	createdTime: number = 0;
	modifiedTime: number = 0;
	pluginVersion: string = "";
	exportRoot: string = "";
	baseURL: string = "";

	themeName: string = "";
	bodyClasses: string = "";
	hasFavicon: boolean = false;
	featureOptions: WebsiteFeatureOptions = new WebsiteFeatureOptions();
}
