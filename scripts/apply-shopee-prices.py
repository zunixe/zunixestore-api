#!/usr/bin/env python3
"""
Samakan harga produk toko dengan Shopee.

  harga jual  = harga Shopee (produk bervarian: harga varian termurah)
  harga coret = originalPrice Shopee bila Shopee sedang mencoret harga;
                selain itu harga jual + 10% (dibulatkan ke atas ke Rp 100)

Pasangan produk toko ↔ item Shopee ada di scripts/plugo-shopee-map.json.
Data harga dari export tabel ShopeeProduct (ZunixeCorp) berformat CSV:
  item_id,name,price,original_price,status,models

Pakai:  python3 scripts/apply-shopee-prices.py <shopee.csv> [--dry-run]
DB di-backup dulu ke backups/ sebelum ditulis.
"""
import csv
import math
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get('DB_PATH', os.path.join(ROOT, 'zunixestore.db'))
STORE_ID = 'adcd528c-c8c7-4e91-8652-7f2e2871d993'
MARKUP = 0.10  # harga coret = harga jual + 10% bila Shopee tidak mencoret harga


def effective_price(row):
    price = float(row.get('price') or 0)
    if price <= 0 and row.get('models'):
        prices = [float(m.get('price') or 0) for m in json.loads(row['models'])]
        prices = [p for p in prices if p > 0]
        price = min(prices) if prices else 0
    return round(price)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if not args:
        sys.exit(__doc__)
    shopee = {r['item_id']: r for r in csv.DictReader(open(args[0], encoding='utf-8'))}
    mapping = json.load(open(os.path.join(ROOT, 'scripts', 'plugo-shopee-map.json'), encoding='utf-8'))

    db = sqlite3.connect(DB_PATH)
    if not dry:
        os.makedirs(os.path.join(ROOT, 'backups'), exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
        backup_path = os.path.join(ROOT, 'backups', f'zunixestore-{stamp}-before-shopee-prices.db')
        with sqlite3.connect(backup_path) as dst:
            db.backup(dst)
        print('backup:', backup_path)

    changes, missing = [], []
    for pid, info in mapping.items():
        row = shopee.get(str(info['shopee_item_id']))
        cur = db.execute('SELECT name, price, description FROM products WHERE id = ? AND store_id = ?', (pid, STORE_ID)).fetchone()
        if not row or not cur:
            missing.append(pid)
            continue
        price = effective_price(row)
        original = round(float(row.get('original_price') or 0))
        if price <= 0:
            missing.append(pid)
            continue
        desc = json.loads(cur[2] or '{}')
        old_retail = desc.get('retail_price')
        if original > price:
            desc['retail_price'] = original
            desc['retail_source'] = 'shopee'
        else:
            desc['retail_price'] = math.ceil(price * (1 + MARKUP) / 100) * 100
            desc['retail_source'] = f'markup_{round(MARKUP * 100)}'
        desc['shopee_item_id'] = str(info['shopee_item_id'])
        desc['price_source'] = 'shopee'
        changes.append((cur[0], cur[1], old_retail, price, desc.get('retail_price')))
        if not dry:
            db.execute("UPDATE products SET price = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
                       (price, json.dumps(desc, ensure_ascii=False), pid))
    if not dry:
        db.commit()

    for name, op, orr, np, nr in changes:
        print(f'{name[:48]:48} {op:>9} / {str(orr or "-"):>9}  →  {np:>9} / {str(nr or "-"):>9}')
    print(f'{len(changes)} produk {"(dry-run)" if dry else "diperbarui"}; tidak ketemu/harga 0: {missing}')


if __name__ == '__main__':
    main()
