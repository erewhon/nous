#!/usr/bin/env python3
"""Test WebSocket event stream from the Nous daemon."""

import asyncio
import sys
sys.path.insert(0, "src")

from nous_sdk import Nous


async def main():
    app = Nous()

    print("Listening for events (will create a test page in 2 seconds)...")

    # Start event listener in background
    async def listen():
        count = 0
        async for event in app.events():
            print(f"  EVENT: {event['event']} -> {event['data']}")
            count += 1
            if count >= 3:
                break

    # Create a page after a short delay to generate events
    async def create_test():
        await asyncio.sleep(2)
        print("Creating test page...")
        page = app.create_page("Nous", title="SDK Event Test", tags=["test", "sdk"])
        print(f"  Created: {page.id}")

        print("Updating page...")
        app.update_page("Nous", page.id, title="SDK Event Test (updated)")
        print("  Updated")

        print("Deleting page...")
        app.delete_page("Nous", page.id)
        print("  Deleted")

    # Run both concurrently
    await asyncio.gather(listen(), create_test())

    print("\nDone! Events received successfully.")


if __name__ == "__main__":
    asyncio.run(main())
