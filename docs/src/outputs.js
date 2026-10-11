// Canned outputs for the interactive demo, one entry per cell in the matching snippet.
// A cell output is `{ blocks: [...] }` where a block is stdout/stderr/error/image/html/markdown.

export const outputs = {
  markers: [
    { blocks: [{ type: "stdout", text: "y = 45\n" }] },
    { blocks: [] },
  ],
  runCell: [{ blocks: [{ type: "stdout", text: "hello from a cell\n" }] }],
  state: [
    { blocks: [] },
    { blocks: [{ type: "stdout", text: "shared + 1 = 42\n" }] },
  ],
  errors: [
    { blocks: [{ type: "error", text: "Error: something went wrong" }] },
    { blocks: [{ type: "stdout", text: "later cells still run\n" }] },
  ],
  ansi: [
    {
      blocks: [
        { type: "stdout", text: "\u001b[31mred\u001b[0m \u001b[32mgreen\u001b[0m \u001b[34mblue\u001b[0m\n" },
      ],
    },
  ],
  progress: [{ blocks: [{ type: "progress", width: 40 }] }],
  image: [{ blocks: [{ type: "image", src: "demo-chart.png", alt: "Rendered PNG" }] }],
  imageB64: [{ blocks: [{ type: "image", src: "demo-chart.png", alt: "Rendered PNG" }] }],
  html: [
    {
      blocks: [
        {
          type: "html",
          html:
            '<svg width="240" height="80" xmlns="http://www.w3.org/2000/svg">' +
            '<rect width="240" height="80" fill="#1f6feb"/>' +
            '<text x="12" y="48" fill="white" font-size="24">Hello IW</text></svg>',
        },
      ],
    },
  ],
  markdown: [
    {
      blocks: [
        { type: "markdown", text: "## Hello from **Deno**\n- renders markdown\n- in the output" },
      ],
    },
  ],
  imports: [{ blocks: [{ type: "stdout", text: "2 + 3 = 5\n" }] }],
};
