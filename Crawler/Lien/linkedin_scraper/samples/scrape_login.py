#!/usr/bin/env python3
"""
Test is_logged_in() Functionality

This script tests the is_logged_in() function to verify it correctly detects
authentication state across different LinkedIn pages and URL patterns.

This validates the fix for issue #269 where is_logged_in() was returning False
even after successful login due to LinkedIn's A/B tested DOM structures.

Usage:
    python samples/scrape_login.py
"""
import asyncio
import os
from linkedin_scraper import BrowserManager
from linkedin_scraper.core.auth import is_logged_in


async def test_login_detection():
    print("="*70)
    print("Testing is_logged_in() Function - Issue #269 Validation")
    print("="*70)
    
    session_file = "linkedin_session.json"
    if not os.path.exists(session_file):
        print(f"\n❌ Error: {session_file} not found!")
        print("\nPlease create a session first:")
        print("  python samples/create_session.py")
        return
    
    print(f"\n✓ Session file found: {session_file}")
    
    test_cases = [
        ("Feed page (authenticated-only)", "https://www.linkedin.com/feed/", True),
        ("Profile page (with nav elements)", "https://www.linkedin.com/in/williamhgates/", True),
        ("Company page (with nav elements)", "https://www.linkedin.com/company/microsoft/", True),
        ("My Network page (authenticated-only)", "https://www.linkedin.com/mynetwork/", True),
    ]
    
    results = []
    
    print("\n" + "-"*70)
    print("Testing with authenticated session")
    print("-"*70)
    
    async with BrowserManager(headless=True) as browser:
        await browser.load_session(session_file)
        print("✓ Session loaded\n")
        
        for description, url, expected in test_cases:
            try:
                print(f"Test: {description}")
                print(f"  URL: {url}")
                
                await browser.page.goto(url, wait_until="domcontentloaded")
                await asyncio.sleep(1)
                
                actual = await is_logged_in(browser.page)
                
                passed = actual == expected
                status = "✓ PASS" if passed else "✗ FAIL"
                
                print(f"  Expected: {expected}")
                print(f"  Actual: {actual}")
                print(f"  {status}\n")
                
                results.append((description, passed))
            except Exception as e:
                print(f"  ✗ FAIL - Exception: {e}\n")
                results.append((description, False))
    
    print("-"*70)
    print("Testing login page (negative test - no authentication)")
    print("-"*70)
    
    try:
        print("Test: Login page in incognito context")
        print("  URL: https://www.linkedin.com/login")
        
        async with BrowserManager(headless=True) as browser:
            await browser.page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
            await asyncio.sleep(1)
            
            actual = await is_logged_in(browser.page)
            expected = False
            
            passed = actual == expected
            status = "✓ PASS" if passed else "✗ FAIL"
            
            print(f"  Expected: {expected}")
            print(f"  Actual: {actual}")
            print(f"  {status}\n")
            
            results.append(("Login page (incognito)", passed))
    except Exception as e:
        print(f"  ✗ FAIL - Exception: {e}\n")
        results.append(("Login page (incognito)", False))
    
    print("="*70)
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    
    print(f"Test Results: {passed_count}/{total_count} tests passed")
    print("="*70)
    
    if passed_count == total_count:
        print("\n✅ All tests passed! Issue #269 fix is working correctly.")
    else:
        print(f"\n⚠️  {total_count - passed_count} test(s) failed:")
        for description, passed in results:
            if not passed:
                print(f"  - {description}")
    
    print("="*70 + "\n")


if __name__ == "__main__":
    asyncio.run(test_login_detection())
