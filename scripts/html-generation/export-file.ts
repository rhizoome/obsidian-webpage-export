import { html_beautify } from "js-beautify";
import { TFile } from "obsidian";
import { Path } from "scripts/utils/path";
import { HTMLGenerator } from "./html-generator";
import { Downloadable } from "scripts/utils/downloadable";
import { MainSettings } from "scripts/settings/main-settings";

export class ExportFile
{
	/**
	 * The original markdown file to export.
	 */
	public file: TFile;

	/**
	 * The absolute path to the FOLDER we are exporting to
	 */
	public exportToFolder: Path;

	/**
	 * The relative path from the vault root to the FOLDER being exported
	 */
	public exportedFolder: Path;

	/**
	 * Is this file part of a batch export, or is it being exported independently?
	 */
	public partOfBatch: boolean;

	/**
	 * The name of the file being exported, with the extension
	 */
	public name: string;

	/**
	 * The relative path from the export folder to the file being exported; includes the file name and extension.
	 */
	public exportPath: Path;

	/**
	 * The document to use to generate the HTML.
	 */
	public document: Document;

	/**
	 * The external files that need to be downloaded for this file to work including the file itself.
	 */
	public downloads: Downloadable[] = [];

	/**
	 * Same as downloads but does not include the file itself.
	 */
	public externalDownloads: Downloadable[] = [];


	/**
	 * @param file The original markdown file to export
	 * @param exportToFolder The absolute path to the FOLDER we are exporting to
	 * @param exportFromFolder The relative path from the vault root to the FOLDER being exported
	 * @param partOfBatch Is this file part of a batch export, or is it being exported independently?
	 * @param fileName The name of the file being exported, with the .html extension
	 * @param forceExportToRoot Force the file to be saved directly int eh export folder rather than in it's subfolder.
	 */
	constructor(file: TFile, exportToFolder: Path, exportFromFolder: Path, partOfBatch: boolean, fileName: string, forceExportToRoot: boolean = false)
	{
		if(exportToFolder.isFile || !exportToFolder.isAbsolute) throw new Error("exportToFolder must be an absolute path to a folder: " + exportToFolder.asString);
		
		this.file = file;
		this.exportToFolder = exportToFolder;
		this.exportedFolder = exportFromFolder;
		this.partOfBatch = partOfBatch;
		this.name = fileName;

		let parentPath = file.parent.path;
		if (parentPath.trim() == "/" || parentPath.trim() == "\\") parentPath = "";
		this.exportPath = Path.joinStrings(parentPath, this.name);
		if (forceExportToRoot) this.exportPath.reparse(this.name);
		this.exportPath.setWorkingDirectory(this.exportToFolder.asString);

		if (MainSettings.settings.makeNamesWebStyle)
		{
			this.name = Path.toWebStyle(this.name);
			this.exportPath.makeWebStyle();
		}

		if(fileName.endsWith(".html"))
		{
			this.document = document.implementation.createHTMLDocument(this.file.basename);
		}
	}

	/**
	 * The HTML string for the file
	 */
	get html(): string
	{
		let htmlString = "<!DOCTYPE html>\n" + this.document.documentElement.outerHTML;
		return htmlString;
	}

	/**
	 * The element that contains the content of the document, aka the markdown-preview-view
	 */
	get contentElement(): HTMLElement
	{
		return this.document.querySelector(".markdown-preview-view") as HTMLElement;
	}

	/**
	 * The element that determines the size of the document, aka the markdown-preview-sizer
	 */
	get sizerElement(): HTMLElement
	{
		return this.document.querySelector(".markdown-preview-sizer") as HTMLElement;
	}

	/**
	 * The absolute path that the file will be saved to
	 */
	get exportPathAbsolute(): Path
	{
		return this.exportToFolder.join(this.exportPath);
	}

	/**
	 * The relative path from exportPath to rootFolder
	 */
	get pathToRoot(): Path
	{
		return Path.getRelativePath(this.exportPath, new Path(this.exportPath.workingDirectory), true).makeUnixStyle();
	}

	get isFileModified(): boolean
	{
		return this.file.stat.mtime > (this.exportPathAbsolute.stat?.mtime.getTime() ?? Number.NEGATIVE_INFINITY);
	}

	/**
	 * Returns a downloadable object to download the .html file to the current path with the current html contents.
	 */
	public async getSelfDownloadable(): Promise<Downloadable>
	{
		let content = (this.document ? this.html : await new Path(this.file.path).readFileBuffer()) ?? "";
		return new Downloadable(this.name, content, this.exportPath.directory.makeForceFolder());
	}

	public async generateHTML(addSelfToDownloads: boolean = false): Promise<ExportFile>
	{
		await HTMLGenerator.getDocumentHTML(this, addSelfToDownloads);
		return this;
	}

	public async generateWebpage(): Promise<ExportFile>
	{
		await HTMLGenerator.generateWebpage(this);
		return this;
	}
}
