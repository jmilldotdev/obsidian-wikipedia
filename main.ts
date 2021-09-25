import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
} from "obsidian";

interface WikiExtract {
  title: string;
  text: string;
  url: string;
}

interface MyPluginSettings {
  template: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  template: "{{text}}",
};

const extractApiUrl =
  "https://en.wikipedia.org/w/api.php?" +
  "format=json&action=query&prop=extracts&explaintext=1&redirects&origin=*&titles=";
export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  getUrl(title: string): string {
    return `https://en.wikipedia.org/wiki/${encodeURI(title)}`;
  }

  formatExtractText(extract: WikiExtract): string {
    const { text, title } = extract;
    return (
      "> " +
      text
        .split("==")[0]
        .trim()
        .replace(title, `**${title}**`)
        .split("\n")
        .join("\n>\n> ")
    );
  }

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found on Wikipedia.`);
  }

  parseResponse(json: any): WikiExtract | undefined {
    const pages = json.query.pages;
    const pageKeys = Object.keys(pages);
    console.log(pageKeys);
    if (pageKeys.includes("-1")) {
      return undefined;
    }
    const extracts: WikiExtract[] = pageKeys.map((key) => {
      const page = pages[key];
      const extract: WikiExtract = {
        title: page.title,
        text: page.extract,
        url: this.getUrl(page.title),
      };
      return extract;
    });
    return extracts[0];
  }

  formatExtractInsert(extract: WikiExtract): string {
    console.log(extract.text);
    const formattedText = this.formatExtractText(extract);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{title}}", extract.title)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWikipediaText(title: string): Promise<WikiExtract | undefined> {
    console.log("getting wiki response");
    const url = extractApiUrl + encodeURIComponent(title);
    const json = await fetch(url).then((response) => response.json());
    const extract = this.parseResponse(json);
    return extract;
  }

  async pasteIntoEditor(searchTerm: string) {
    const extract: WikiExtract = await this.getWikipediaText(searchTerm);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    const editor = this.getEditor();
    editor.replaceSelection(this.formatExtractInsert(extract));
  }

  async getWikipediaTextForActiveFile() {
    const searchTerm = await this.app.workspace.getActiveFile().basename;
    await this.pasteIntoEditor(searchTerm);
  }

  async getWikipediaTextForSearchTerm() {
    const leaf = this.app.workspace.activeLeaf;
    if (leaf) {
      new SearchModel(this.app).open();
    }
    const searchTerm = "North America";
    await this.pasteIntoEditor(searchTerm);
  }

  async onload() {
    console.log("loading plugin");

    await this.loadSettings();

    this.addCommand({
      id: "wikipedia-get-active-note-title",
      name: "Get Active Note Title",
      callback: () => this.getWikipediaTextForActiveFile(),
    });

    this.addCommand({
      id: "wikipedia-get-search-term",
      name: "Get Search Term",
      callback: () => this.getWikipediaTextForSearchTerm(),
    });

    this.addSettingTab(new SampleSettingTab(this.app, this));
  }

  onunload() {
    console.log("unloading plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getEditor(): Editor {
    let activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeLeaf == null) return;
    return activeLeaf.editor;
  }
}

class SearchModel extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    let { contentEl } = this;
    contentEl.setText("Enter Search Term:");
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Wikipedia" });

    new Setting(containerEl)
      .setName("Wikipedia Extract Template")
      .setDesc(
        "Set markdown template for extract to be inserted. Available template variables are {{title}}, {{text}}, and {{url}}."
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.template)
          .onChange(async (value) => {
            console.log(value);
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
