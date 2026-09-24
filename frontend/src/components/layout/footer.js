// components/layout/footer.js
export function Footer() {
    return (
      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} eBadge ID. All rights reserved.</p>
      </footer>
    )
  }