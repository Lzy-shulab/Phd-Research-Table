"""Generate a public, synthetic fixture; never send personal research to a test service."""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
root.mkdir(parents=True, exist_ok=True)
doc = fitz.open()
page = doc.new_page(width=595, height=842)
page.insert_text((50, 62), 'Research workflow translation check', fontsize=19)
page.insert_text((50, 87), 'Generated test document - not a scientific publication', fontsize=10, color=(.4,.4,.4))
page.insert_textbox(fitz.Rect(50, 125, 545, 500), '''Abstract
This document is generated solely to verify a local research workbench. It contains no private data and makes no scientific claims. The translation workflow should preserve the English source and produce a Chinese translation on the right side of the same page.

Research planning
Every research plan belongs to a project. A project can contain reading tasks, experiments, and writing tasks. Switching between today's plans and the calendar should keep the selected project in view.

Literature reading
Researchers can organize PDF documents in custom journal folders. After a document is imported, a background job translates it. The original PDF remains available while the translation is running. When translation finishes, the bilingual document is attached to the same library card.

Verification
The application should remember the selected reading page after restart. If translation fails, the original file must remain readable and the user should be able to retry.''', fontsize=12, lineheight=1.5)
page.draw_rect(fitz.Rect(50, 530, 545, 600), color=(.4,.5,.7), fill=(.94,.96,.99))
page.insert_text((70, 559), 'Project  >  Plan  >  Reading  >  Notes', fontsize=13)
page.insert_text((70, 582), 'A simple layout check: y = x + 1', fontsize=11)
page.insert_text((50, 785), 'Synthetic verification fixture | 1', fontsize=9)
doc.set_metadata({'title': 'Research workflow translation check', 'author': 'Workbench verification fixture'})
doc.save(root / 'translation-check.pdf')
doc.close()
print(root / 'translation-check.pdf')
