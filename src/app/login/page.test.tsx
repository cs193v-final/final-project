// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PAGE_TITLE } from "@/components/ui/controls";

// The pages only pass the actions to the form; these tests never submit it.
vi.mock("@/app/account/actions", () => ({ loginAction: vi.fn(), registerAction: vi.fn() }));

const { default: LoginPage } = await import("./page");
const { default: RegisterPage } = await import("../register/page");

// The form streams in (it reads `?next=`), so render the static shell, as
// Next does, and query the HTML like a user would (as in play/page.test.tsx).
describe.each([
  ["/login", LoginPage, "Log in"],
  ["/register", RegisterPage, "Create an account"],
])("%s", (_path, Page, title) => {
  const render = () => {
    document.body.innerHTML = renderToString(<Page params={Promise.resolve({})} searchParams={Promise.resolve({})} />);
  };

  it('links home with "Home", like /play, /daily and the site header (#80), the arrow hidden from screen readers', () => {
    render();
    const link = within(screen.getByRole("navigation", { name: "Back" })).getByRole("link", { name: "Home" });
    expect(link).toHaveAttribute("href", "/");
    expect(link.querySelector('[aria-hidden="true"]')).toHaveTextContent("←");
    expect(screen.queryByRole("link", { name: /back to start/i })).not.toBeInTheDocument();
  });

  it("titles the page in the display face (#183)", () => {
    render();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(title);
    expect(heading.className).toBe(PAGE_TITLE);
  });
});
